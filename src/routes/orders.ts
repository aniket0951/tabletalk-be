import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import { upsertCustomer } from "../lib/customer";
import { orderListSelect, orderDetailSelect, orderDetailInclude } from "../lib/order-select";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const ordersRoutes = new Hono<Env>();

ordersRoutes.use("*", ownerAuth, subscriptionGuard);

// GET /orders
ordersRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const status = c.req.query("status");
    const staffId = c.req.query("staffId");
    const customerPhone = c.req.query("customerPhone");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const search = c.req.query("search")?.trim() || "";
    const pageParam = c.req.query("page");
    const limitParam = c.req.query("limit");

    const dateFilter: Record<string, Date> = {};
    if (from) {
      const [y, m, d] = from.split("-").map(Number);
      dateFilter.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    if (to) {
      const [y, m, d] = to.split("-").map(Number);
      dateFilter.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
    }

    const baseWhere = {
      restaurantId,
      ...(staffId ? { staffId } : {}),
      ...(customerPhone ? { customerPhone } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
      ...(search
        ? {
            OR: [
              { orderCode: { contains: search, mode: "insensitive" as const } },
              { table: { label: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };

    if (!pageParam) {
      const orders = await prisma.order.findMany({
        where: { ...baseWhere, ...(status ? { status: status as never } : {}) },
        select: orderListSelect,
        orderBy: { placedAt: "desc" },
      });
      return c.json(orders);
    }

    const page = Math.max(1, parseInt(pageParam, 10));
    const limit = Math.min(50, Math.max(1, parseInt(limitParam || "20", 10)));

    const filteredWhere = { ...baseWhere, ...(status && status !== "ALL" ? { status: status as never } : {}) };

    const [orders, totalFiltered, ...statusCountResults] = await Promise.all([
      prisma.order.findMany({
        where: filteredWhere,
        select: orderListSelect,
        orderBy: { placedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where: filteredWhere }),
      prisma.order.count({ where: { ...baseWhere, status: "NEW" } }),
      prisma.order.count({ where: { ...baseWhere, status: "COOKING" } }),
      prisma.order.count({ where: { ...baseWhere, status: "READY" } }),
      prisma.order.count({ where: { ...baseWhere, status: "BILLED" } }),
      prisma.order.count({ where: { ...baseWhere, status: "SETTLED" } }),
    ]);

    const statusCounts = {
      NEW: statusCountResults[0],
      COOKING: statusCountResults[1],
      READY: statusCountResults[2],
      BILLED: statusCountResults[3],
      SETTLED: statusCountResults[4],
    };
    const totalAll = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    return c.json({
      orders,
      statusCounts,
      totalAll,
      pagination: { page, limit, totalFiltered, totalPages: Math.ceil(totalFiltered / limit) },
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /orders/:id
ordersRoutes.get("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    // Lean detail query — only what the drawer UI needs
    const order = await prisma.order.findUnique({
      where: { id },
      select: orderDetailSelect,
    });
    if (!order || order.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json(order);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /orders/:id
ordersRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing || existing.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();

    const timestampMap: Record<string, string> = {
      COOKING: "cookingAt",
      READY: "readyAt",
      BILLED: "billedAt",
      SETTLED: "settledAt",
    };

    const updateData: Record<string, unknown> = {};

    if (body.status) {
      updateData.status = body.status;
      if (timestampMap[body.status]) {
        updateData[timestampMap[body.status]] = new Date();
      }
      // Auto-set confirmedAt when moving to COOKING (if not already set)
      if (body.status === "COOKING" && !existing.confirmedAt) {
        updateData.confirmedAt = new Date();
      }
    }

    if (body.staffId !== undefined) {
      updateData.staffId = body.staffId || null;
    }

    let order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: orderDetailInclude,
    });

    // Set table to FREE when order is settled (if no other active orders on this table)
    if (body.status === "SETTLED" && existing.tableId) {
      const otherActive = await prisma.order.count({
        where: {
          tableId: existing.tableId,
          status: { notIn: ["SETTLED"] },
          id: { not: id },
          isDeleted: false,
        },
      });
      if (otherActive === 0) {
        await prisma.diningTable.update({
          where: { id: existing.tableId },
          data: { status: "FREE" },
        });
        emitSocketEvent("table:updated", { id: existing.tableId, status: "FREE" });
      }
    }

    if (body.status === "SETTLED" && order.customerPhone && !order.customerId) {
      const customerId = await upsertCustomer({
        restaurantId: order.restaurantId,
        phone: order.customerPhone,
        name: order.customerName || undefined,
        orderTotal: order.total,
      });
      if (customerId) {
        order = await prisma.order.update({
          where: { id },
          data: { customerId },
          include: orderDetailInclude,
        });
      }
    }

    emitSocketEvent("order:updated", order);
    return c.json(order);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
