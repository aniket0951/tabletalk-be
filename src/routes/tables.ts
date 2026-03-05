import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";

export const tablesRoutes = new Hono<Env>();

tablesRoutes.use("*", ownerAuth);

// GET /tables
tablesRoutes.get("/", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const tables = await prisma.diningTable.findMany({
      where: { restaurantId: restaurant.id },
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
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const { label, capacity } = await c.req.json();
    if (!label) return c.json({ error: "Missing label" }, 400);

    const maxTable = await prisma.diningTable.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { tableNumber: "desc" },
    });

    const table = await prisma.diningTable.create({
      data: {
        tableNumber: (maxTable?.tableNumber || 0) + 1,
        label,
        capacity: capacity || 4,
        restaurantId: restaurant.id,
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
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const existing = await prisma.diningTable.findUnique({ where: { id } });
    if (!existing || existing.restaurantId !== restaurant.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const data = await c.req.json();
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
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const table = await prisma.diningTable.findUnique({ where: { id } });
    if (!table || table.restaurantId !== restaurant.id) {
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
