import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, TABLE_STATUS, SOCKET_EVENT } from "../lib/constants";
import { tableRepository } from "../repositories/table.repository";
import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const tablesRoutes = new Hono<Env>();

tablesRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /tables
tablesRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const tables = await tableRepository.findMany(restaurantId);
    return success(c, tables, "Tables fetched");
  } catch (err) {
    logger.error("GET /tables", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /tables
tablesRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const { label, capacity } = await c.req.json();
    if (!label) return validationError(c, "Missing label");

    const maxTable = await tableRepository.findMaxTableNumber(restaurantId);

    const table = await tableRepository.create({
      tableNumber: (maxTable?.tableNumber || 0) + 1,
      label,
      capacity: capacity || 4,
      restaurantId,
    });

    return success(c, table, "Table created");
  } catch (err) {
    logger.error("POST /tables", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /tables/:id
tablesRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await tableRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return validationError(c, "Not found");
    }

    const body = await c.req.json();

    // Whitelist allowed fields
    const data: Record<string, unknown> = {};
    if (body.label !== undefined) data.label = String(body.label).slice(0, 50);
    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        return validationError(c, "Invalid capacity (1-100)");
      }
      data.capacity = cap;
    }
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.status !== undefined) {
      if (![TABLE_STATUS.FREE, TABLE_STATUS.OCCUPIED].includes(body.status)) {
        return validationError(c, "Invalid status");
      }
      data.status = body.status;
    }

    const table = await tableRepository.update(id, data);

    emitSocketEvent(SOCKET_EVENT.TABLE_UPDATED, table);
    return success(c, table, "Table updated");
  } catch (err) {
    logger.error("PATCH /tables/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// DELETE /tables/:id
tablesRoutes.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const table = await tableRepository.findById(id);
    if (!table) {
      return validationError(c, "Not found");
    }
    if (table.status === TABLE_STATUS.OCCUPIED) {
      return validationError(c, "Cannot delete occupied table");
    }

    await tableRepository.softDelete(id);
    return success(c, null, "Table deleted");
  } catch (err) {
    logger.error("DELETE /tables/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
