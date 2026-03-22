import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX } from "../lib/constants";
import { menuRepository } from "../repositories/menu.repository";
import { menuService, MenuError } from "../services/menu.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const menuRoutes = new Hono<Env>();

menuRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /menu/categories — categories only with item count (for tab view)
menuRoutes.get("/categories", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const categories = await menuRepository.findCategories(restaurantId);
    return success(c, categories, "Categories fetched");
  } catch (err) {
    logger.error("GET /menu/categories", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
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

    return success(c, { items, pagination: { page, limit, hasMore } }, "Items fetched");
  } catch (err) {
    logger.error("GET /menu/categories/:categoryId/items", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /menu/items — all categories with items (backward compat)
menuRoutes.get("/items", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const categories = await menuRepository.findAllWithItems(restaurantId);
    return success(c, categories, "Menu items fetched");
  } catch (err) {
    logger.error("GET /menu/items", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /menu/items
menuRoutes.post("/items", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const body = await c.req.json();
    const item = await menuService.createItem(restaurantId, body);
    return success(c, item, "Menu item created");
  } catch (err) {
    if (err instanceof MenuError) return validationError(c, err.message);
    logger.error("POST /menu/items", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /menu/items/:id
menuRoutes.patch("/items/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await menuRepository.findItemById(id);
    if (!existing || existing.category.restaurantId !== restaurantId) {
      return validationError(c, "Not found");
    }

    const body = await c.req.json();
    const result = menuService.validateItemUpdate(body);
    if (result instanceof MenuError) {
      return validationError(c, result.message);
    }

    const item = await menuRepository.updateItem(id, result);
    return success(c, item, "Menu item updated");
  } catch (err) {
    logger.error("PATCH /menu/items/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// DELETE /menu/items/:id
menuRoutes.delete("/items/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await menuRepository.findItemById(id);
    if (!existing || existing.category.restaurantId !== restaurantId) {
      return validationError(c, "Not found");
    }

    await menuRepository.deleteItem(id);
    return success(c, null, "Menu item deleted");
  } catch (err) {
    logger.error("DELETE /menu/items/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /menu/categories
menuRoutes.post("/categories", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const { name, emoji } = await c.req.json();
    const category = await menuService.createCategory(restaurantId, name, emoji);
    return success(c, category, "Category created");
  } catch (err) {
    if (err instanceof MenuError) return validationError(c, err.message);
    logger.error("POST /menu/categories", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /menu/categories/defaults
menuRoutes.post("/categories/defaults", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const existing = await menuRepository.countCategories(restaurantId);
    if (existing > 0) {
      return validationError(c, "Categories already exist");
    }

    await menuRepository.seedDefaults(restaurantId);
    return success(c, null, "Default categories created");
  } catch (err) {
    logger.error("POST /menu/categories/defaults", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
