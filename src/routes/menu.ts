import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";

export const menuRoutes = new Hono<Env>();

menuRoutes.use("*", ownerAuth);

// GET /menu/items
menuRoutes.get("/items", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId: restaurant.id },
      include: { items: true },
      orderBy: { sortOrder: "asc" },
    });

    return c.json(categories);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /menu/items
menuRoutes.post("/items", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const { name, description, price, type, categoryId } = await c.req.json();

    if (!name || !price || !categoryId) {
      return c.json({ error: "Missing fields" }, 400);
    }

    const category = await prisma.menuCategory.findFirst({
      where: { id: categoryId, restaurantId: restaurant.id },
    });
    if (!category) return c.json({ error: "Category not found" }, 404);

    const item = await prisma.menuItem.create({
      data: { name, description: description || "", price, type: type || "VEG", categoryId, restaurantId: restaurant.id },
    });

    emitSocketEvent("menu:updated", item);
    return c.json(item);
  } catch (error) {
    console.log("Menu Item POST Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /menu/items/:id
menuRoutes.patch("/items/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const existing = await prisma.menuItem.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!existing || existing.category.restaurantId !== restaurant.id) {
      return c.json({ error: "Not found" }, 404);
    }

    const data = await c.req.json();
    const item = await prisma.menuItem.update({
      where: { id },
      data,
    });

    emitSocketEvent("menu:updated", item);
    return c.json(item);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// DELETE /menu/items/:id
menuRoutes.delete("/items/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const existing = await prisma.menuItem.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!existing || existing.category.restaurantId !== restaurant.id) {
      return c.json({ error: "Not found" }, 404);
    }

    await prisma.menuItem.delete({ where: { id } });
    emitSocketEvent("menu:updated", { id, deleted: true });
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /menu/categories
menuRoutes.post("/categories", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const { name, emoji } = await c.req.json();
    if (!name?.trim()) {
      return c.json({ error: "Category name is required" }, 400);
    }

    const maxSort = await prisma.menuCategory.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { sortOrder: "desc" },
    });

    const category = await prisma.menuCategory.create({
      data: {
        name: name.trim(),
        emoji: emoji || "\uD83C\uDF7D",
        sortOrder: (maxSort?.sortOrder ?? -1) + 1,
        restaurantId: restaurant.id,
      },
    });

    emitSocketEvent("menu:updated", category);
    return c.json(category);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /menu/categories/defaults
menuRoutes.post("/categories/defaults", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const existing = await prisma.menuCategory.count({
      where: { restaurantId: restaurant.id },
    });
    if (existing > 0) {
      return c.json({ error: "Categories already exist" }, 409);
    }

    const defaultCategories = [
      { name: "Starters", emoji: "\uD83E\uDD57", sortOrder: 0 },
      { name: "Mains", emoji: "\uD83C\uDF5B", sortOrder: 1 },
      { name: "Desserts", emoji: "\uD83C\uDF70", sortOrder: 2 },
    ];

    await prisma.menuCategory.createMany({
      data: defaultCategories.map((cat) => ({
        ...cat,
        restaurantId: restaurant.id,
      })),
    });

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
