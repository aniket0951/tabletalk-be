import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { staffAuth } from "../middleware/staff-auth";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";

// Lean select for staff order cards — only what the UI needs
const staffOrderSelect = {
  id: true,
  orderCode: true,
  status: true,
  total: true,
  placedAt: true,
  staffId: true,
  table: { select: { label: true } },
  items: {
    where: { isDeleted: false },
    select: {
      quantity: true,
      menuItem: { select: { name: true, type: true } },
    },
  },
} as const;

export const staffOrdersRoutes = new Hono<Env>();

staffOrdersRoutes.use("*", staffAuth);

// GET /staff/orders
staffOrdersRoutes.get("/", async (c) => {
  try {
    const payload = c.get("staff");

    const from = c.req.query("from");
    const to = c.req.query("to");

    const dateFilter: Record<string, Date> = {};
    if (from) {
      const [y, m, d] = from.split("-").map(Number);
      dateFilter.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    if (to) {
      const [y, m, d] = to.split("-").map(Number);
      dateFilter.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
    }

    const orders = await prisma.order.findMany({
      where: {
        restaurantId: payload.restaurantId,
        staffId: payload.staffId,
        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
      },
      select: staffOrderSelect,
      orderBy: { placedAt: "desc" },
    });
    return c.json(orders);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /staff/orders/:id
staffOrdersRoutes.patch("/:id", async (c) => {
  try {
    const payload = c.get("staff");
    const id = c.req.param("id");
    const { status } = await c.req.json();

    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing || existing.restaurantId !== payload.restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    const timestampMap: Record<string, string> = {
      COOKING: "cookingAt",
      READY: "readyAt",
      BILLED: "billedAt",
      SETTLED: "settledAt",
    };

    const updateData: Record<string, unknown> = { status };
    if (timestampMap[status]) {
      updateData[timestampMap[status]] = new Date();
    }
    // Auto-set confirmedAt when moving to COOKING (if not already set)
    if (status === "COOKING" && !existing.confirmedAt) {
      updateData.confirmedAt = new Date();
    }

    // Full update for socket broadcast (dashboard/customer needs full data)
    const fullOrder = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        items: { include: { menuItem: true }, where: { isDeleted: false } },
        table: true,
        staff: { select: { id: true, name: true, role: true } },
      },
    });
    emitSocketEvent("order:updated", fullOrder);

    // Set table to FREE when order is settled (if no other active orders on this table)
    if (status === "SETTLED" && existing.tableId) {
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

    // Lean response for staff UI
    const leanOrder = await prisma.order.findUnique({
      where: { id },
      select: staffOrderSelect,
    });
    return c.json(leanOrder);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
