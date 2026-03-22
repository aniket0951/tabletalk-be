import { Hono } from "hono";
import { staffAuth } from "../middleware/staff-auth";
import { emitSocketEvent } from "../lib/socket";
import { ORDER_STATUS, SOCKET_EVENT } from "../lib/constants";
import { orderRepository } from "../repositories/order.repository";
import { tableRepository } from "../repositories/table.repository";
import { orderService, validateStatusTransition } from "../services/order.service";

import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const staffOrdersRoutes = new Hono<Env>();

staffOrdersRoutes.use("*", staffAuth);

// GET /staff/orders
staffOrdersRoutes.get("/", async (c) => {
  try {
    const payload = c.get("staff");

    const from = c.req.query("from");
    const to = c.req.query("to");

    const dateFilter = orderService.parseDateFilter(from, to);

    const orders = await orderRepository.findStaffOrders(
      payload.restaurantId,
      payload.staffId,
      dateFilter
    );
    return success(c, orders, "Staff orders fetched");
  } catch (err) {
    logger.error("GET /staff/orders", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /staff/orders/:id
staffOrdersRoutes.patch("/:id", async (c) => {
  try {
    const payload = c.get("staff");
    const id = c.req.param("id");
    const { status } = await c.req.json();

    const existing = await orderRepository.findById(id);
    if (!existing || existing.restaurantId !== payload.restaurantId) {
      return validationError(c, "Not found");
    }

    const transitionError = validateStatusTransition(existing.status, status);
    if (transitionError) {
      return validationError(c, transitionError);
    }

    const updateData = orderService.buildStatusUpdateData(status, existing);

    // Full update for socket broadcast (dashboard/customer needs full data)
    const fullOrder = await orderRepository.updateWithBroadcastInclude(id, updateData);
    emitSocketEvent(SOCKET_EVENT.ORDER_UPDATED, fullOrder);

    // Free table on settlement
    if (status === ORDER_STATUS.SETTLED && existing.tableId) {
      const otherActive = await orderRepository.countOtherActiveOnTable(existing.tableId, id);
      if (otherActive === 0) {
        await tableRepository.update(existing.tableId, { status: "FREE" });
        emitSocketEvent(SOCKET_EVENT.TABLE_UPDATED, { id: existing.tableId, status: "FREE" });
      }
    }

    // Lean response for staff UI
    const leanOrder = await orderRepository.findByIdWithStaffSelect(id);
    return success(c, leanOrder, "Order updated");
  } catch (err) {
    logger.error("PATCH /staff/orders/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
