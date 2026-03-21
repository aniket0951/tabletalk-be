import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, TABLE_STATUS, SOCKET_EVENT } from "../lib/constants";
import { tableRepository } from "../repositories/table.repository";
import type { Env } from "../types";

export const tablesRoutes = new Hono<Env>();

tablesRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /tables
tablesRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const tables = await tableRepository.findMany(restaurantId);
    return c.json(tables);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /tables
tablesRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const { label, capacity } = await c.req.json();
    if (!label) return c.json({ error: "Missing label" }, 400);

    const maxTable = await tableRepository.findMaxTableNumber(restaurantId);

    const table = await tableRepository.create({
      tableNumber: (maxTable?.tableNumber || 0) + 1,
      label,
      capacity: capacity || 4,
      restaurantId,
    });

    return c.json(table);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /tables/:id
tablesRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await tableRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();

    // Whitelist allowed fields
    const data: Record<string, unknown> = {};
    if (body.label !== undefined) data.label = String(body.label).slice(0, 50);
    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        return c.json({ error: "Invalid capacity (1-100)" }, 400);
      }
      data.capacity = cap;
    }
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.status !== undefined) {
      if (![TABLE_STATUS.FREE, TABLE_STATUS.OCCUPIED].includes(body.status)) {
        return c.json({ error: "Invalid status" }, 400);
      }
      data.status = body.status;
    }

    const table = await tableRepository.update(id, data);

    emitSocketEvent(SOCKET_EVENT.TABLE_UPDATED, table);
    return c.json(table);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// DELETE /tables/:id
tablesRoutes.delete("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const table = await tableRepository.findById(id);
    if (!table || table.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }
    if (table.status === TABLE_STATUS.OCCUPIED) {
      return c.json({ error: "Cannot delete occupied table" }, 400);
    }

    await tableRepository.remove(id);
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
