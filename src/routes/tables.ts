import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";
import { CONTEXT_KEYS } from "./constants";

export const tablesRoutes = new Hono<Env>();

tablesRoutes.use("*", ownerAuth, subscriptionGuard);

// GET /tables
tablesRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const tables = await prisma.diningTable.findMany({
      where: { restaurantId },
      orderBy: { tableNumber: "asc" },
    });

    return c.json(tables);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /tables
tablesRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CONTEXT_KEYS.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const { label, capacity } = await c.req.json();
    if (!label) return c.json({ error: "Missing label" }, 400);

    const maxTable = await prisma.diningTable.findFirst({
      where: { restaurantId },
      orderBy: { tableNumber: "desc" },
    });

    const table = await prisma.diningTable.create({
      data: {
        tableNumber: (maxTable?.tableNumber || 0) + 1,
        label,
        capacity: capacity || 4,
        restaurantId,
      },
    });

    emitSocketEvent("table:created", table);
    return c.json(table);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /tables/:id
tablesRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CONTEXT_KEYS.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const existing = await prisma.diningTable.findUnique({ where: { id } });
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
      if (!["FREE", "OCCUPIED"].includes(body.status)) {
        return c.json({ error: "Invalid status" }, 400);
      }
      data.status = body.status;
    }

    const table = await prisma.diningTable.update({
      where: { id },
      data,
    });

    emitSocketEvent("table:updated", table);
    return c.json(table);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// DELETE /tables/:id
tablesRoutes.delete("/:id", async (c) => {
  try {
    const restaurantId = c.get(CONTEXT_KEYS.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const table = await prisma.diningTable.findUnique({ where: { id } });
    if (!table || table.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }
    if (table.status === "OCCUPIED") {
      return c.json({ error: "Cannot delete occupied table" }, 400);
    }

    await prisma.diningTable.delete({ where: { id } });
    emitSocketEvent("table:deleted", { id });
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
