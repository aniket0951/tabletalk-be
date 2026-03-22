import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, ORDER_STATUS, SOCKET_EVENT } from "../lib/constants";
import { orderRepository } from "../repositories/order.repository";
import { orderService, OrderError, validateStatusTransition } from "../services/order.service";

import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const ordersRoutes = new Hono<Env>();

ordersRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /orders
ordersRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const status = c.req.query("status");
    const staffId = c.req.query("staffId");
    const customerPhone = c.req.query("customerPhone");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const search = c.req.query("search")?.trim() || "";
    const pageParam = c.req.query("page");
    const limitParam = c.req.query("limit");

    const dateFilter = orderService.parseDateFilter(from, to);

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

    const page = Math.max(1, parseInt(pageParam || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(limitParam || "20", 10)));

    const filteredWhere = { ...baseWhere, ...(status && status !== "ALL" ? { status: status as never } : {}) };

    const [orders, totalFiltered, statusCounts] = await Promise.all([
      orderRepository.findMany(filteredWhere, { skip: (page - 1) * limit, take: limit }),
      orderRepository.count(filteredWhere),
      orderRepository.countByStatus(baseWhere),
    ]);

    const totalAll = Object.values(statusCounts).reduce((a, b) => a + b, 0);

    return success(c, {
      orders,
      statusCounts,
      totalAll,
      pagination: { page, limit, totalFiltered, totalPages: Math.ceil(totalFiltered / limit) },
    }, "Orders fetched");
  } catch (err) {
    logger.error("GET /orders", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /orders/:id
ordersRoutes.get("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const order = await orderRepository.findByIdWithDetail(id);
    if (!order || order.restaurantId !== restaurantId) {
      return validationError(c, "Not found");
    }

    return success(c, order, "Order fetched");
  } catch (err) {
    logger.error("GET /orders/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /orders/:id
ordersRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await orderRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return validationError(c, "Not found");
    }

    const body = await c.req.json();

    const updateData: Record<string, unknown> = {};

    if (body.status) {
      const transitionError = validateStatusTransition(existing.status, body.status);
      if (transitionError) {
        return validationError(c, transitionError);
      }
      Object.assign(updateData, orderService.buildStatusUpdateData(body.status, existing));
    }

    if (body.staffId !== undefined) {
      updateData.staffId = body.staffId || null;
    }

    let order = await orderRepository.update(id, updateData);

    if (body.status === ORDER_STATUS.SETTLED) {
      const updatedOrder = await orderService.settleOrder(id, existing, order);
      if (updatedOrder) order = updatedOrder;
    }

    emitSocketEvent(SOCKET_EVENT.ORDER_UPDATED, order);
    return success(c, order, "Order updated");
  } catch (err) {
    logger.error("PATCH /orders/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
