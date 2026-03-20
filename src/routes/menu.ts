import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";

export const menuRoutes = new Hono<Env>();

menuRoutes.use("*", ownerAuth, subscriptionGuard);

// GET /menu/categories — categories only with item count (for tab view)
menuRoutes.get("/categories", async (c) => {
  try {
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId },
      select: {
        id: true,
        name: true,
        emoji: true,
        sortOrder: true,
        _count: { select: { items: { where: { isDeleted: false } } } },
      },
      orderBy: { sortOrder: "asc" },
    });
    return c.json(categories);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /menu/categories/:categoryId/items — items for one category
menuRoutes.get("/categories/:categoryId/items", async (c) => {
  try {
    const categoryId = c.req.param("categoryId");

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));

    const where = { categoryId, isDeleted: false };

    // Fetch limit+1 to check if more exist — avoids separate count query
    const items = await prisma.menuItem.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        type: true,
        available: true,
        categoryId: true,
        averageRating: true,
        ratingCount: true,
      },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit + 1,
    });

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return c.json({
      items,
      pagination: { page, limit, hasMore },
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /menu/items — all categories with items (backward compat)
menuRoutes.get("/items", async (c) => {
  try {
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId },
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
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const { name, description, price, type, categoryId } = await c.req.json();

    if (!name || !price || !categoryId) {
      return c.json({ error: "Missing fields" }, 400);
    }

    const category = await prisma.menuCategory.findFirst({
      where: { id: categoryId, restaurantId },
    });
    if (!category) return c.json({ error: "Category not found" }, 404);

    const item = await prisma.menuItem.create({
      data: { name, description: description || "", price, type: type || "VEG", categoryId, restaurantId },
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
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const existing = await prisma.menuItem.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!existing || existing.category.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();

    // Whitelist allowed fields — prevent overwriting restaurantId, categoryId, etc.
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = String(body.name).slice(0, 100);
    if (body.description !== undefined) data.description = String(body.description).slice(0, 500);
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (isNaN(price) || price < 0 || price > 100000) {
        return c.json({ error: "Invalid price (0-100000)" }, 400);
      }
      data.price = price;
    }
    if (body.type !== undefined) {
      if (!["VEG", "NON_VEG"].includes(body.type)) {
        return c.json({ error: "Invalid type (VEG or NON_VEG)" }, 400);
      }
      data.type = body.type;
    }
    if (body.available !== undefined) data.available = Boolean(body.available);

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
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const existing = await prisma.menuItem.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!existing || existing.category.restaurantId !== restaurantId) {
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
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const { name, emoji } = await c.req.json();
    if (!name?.trim()) {
      return c.json({ error: "Category name is required" }, 400);
    }

    const maxSort = await prisma.menuCategory.findFirst({
      where: { restaurantId },
      orderBy: { sortOrder: "desc" },
    });

    const category = await prisma.menuCategory.create({
      data: {
        name: name.trim(),
        emoji: emoji || "\uD83C\uDF7D",
        sortOrder: (maxSort?.sortOrder ?? -1) + 1,
        restaurantId,
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
    const restaurantId = c.get("restaurantId");
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const existing = await prisma.menuCategory.count({
      where: { restaurantId },
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
        restaurantId,
      })),
    });

    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
