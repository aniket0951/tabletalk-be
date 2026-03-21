import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX } from "../lib/constants";
import { menuRepository } from "../repositories/menu.repository";
import { menuService, MenuError } from "../services/menu.service";
import type { Env } from "../types";

export const menuRoutes = new Hono<Env>();

menuRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /menu/categories — categories only with item count (for tab view)
menuRoutes.get("/categories", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const categories = await menuRepository.findCategories(restaurantId);
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

    const items = await menuRepository.findItemsByCategory(categoryId, page, limit);

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return c.json({ items, pagination: { page, limit, hasMore } });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /menu/items — all categories with items (backward compat)
menuRoutes.get("/items", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const categories = await menuRepository.findAllWithItems(restaurantId);
    return c.json(categories);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /menu/items
menuRoutes.post("/items", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const body = await c.req.json();
    const item = await menuService.createItem(restaurantId, body);
    return c.json(item);
  } catch (err) {
    if (err instanceof MenuError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /menu/items/:id
menuRoutes.patch("/items/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await menuRepository.findItemById(id);
    if (!existing || existing.category.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = await c.req.json();
    const result = menuService.validateItemUpdate(body);
    if (result instanceof MenuError) {
      return c.json({ error: result.message }, result.statusCode as 400);
    }

    const item = await menuRepository.updateItem(id, result);
    return c.json(item);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// DELETE /menu/items/:id
menuRoutes.delete("/items/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await menuRepository.findItemById(id);
    if (!existing || existing.category.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    await menuRepository.deleteItem(id);
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /menu/categories
menuRoutes.post("/categories", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const { name, emoji } = await c.req.json();
    const category = await menuService.createCategory(restaurantId, name, emoji);
    return c.json(category);
  } catch (err) {
    if (err instanceof MenuError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /menu/categories/defaults
menuRoutes.post("/categories/defaults", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const existing = await menuRepository.countCategories(restaurantId);
    if (existing > 0) {
      return c.json({ error: "Categories already exist" }, 409);
    }

    await menuRepository.seedDefaults(restaurantId);
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
