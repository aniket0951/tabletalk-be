import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { rateLimit } from "../middleware/rate-limit";
import { ORDER_STATUS } from "../lib/constants";
import { orderRepository } from "../repositories/order.repository";
import { tableRepository } from "../repositories/table.repository";
import { menuRepository } from "../repositories/menu.repository";
import { ratingRepository } from "../repositories/rating.repository";
import { orderService, OrderError } from "../services/order.service";
import { offerRepository } from "../repositories/offer.repository";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const publicRoutes = new Hono();

// GET /public/table/:tableId — table info + restaurant name
publicRoutes.get("/table/:tableId", async (c) => {
  try {
    const tableId = c.req.param("tableId");

    const table = await tableRepository.findByIdWithRestaurant(tableId);

    if (!table || table.isDeleted) {
      return validationError(c, "Table not found");
    }

    return success(c, {
      id: table.id,
      tableNumber: table.tableNumber,
      label: table.label,
      capacity: table.capacity,
      restaurant: table.restaurant,
    }, "Table fetched");
  } catch (err) {
    logger.error("GET /public/table/:tableId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/menu/:restaurantId — categories only (no items)
publicRoutes.get("/menu/:restaurantId", async (c) => {
  try {
    const restaurantId = c.req.param("restaurantId");
    const categories = await menuRepository.findPublicCategories(restaurantId);
    return success(c, categories, "Menu categories fetched");
  } catch (err) {
    logger.error("GET /public/menu/:restaurantId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/menu/:restaurantId/category/:categoryId — items for one category
publicRoutes.get("/menu/:restaurantId/category/:categoryId", async (c) => {
  try {
    const restaurantId = c.req.param("restaurantId");
    const categoryId = c.req.param("categoryId");

    const category = await menuRepository.findCategoryByIdAndRestaurant(categoryId, restaurantId);
    if (!category) return validationError(c, "Category not found");

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

    const items = await menuRepository.findAvailableItems(categoryId, page, limit);

    return success(c, items, "Menu items fetched");
  } catch (err) {
    logger.error("GET /public/menu/:restaurantId/category/:categoryId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/offers/:restaurantId — active offers for menu display
publicRoutes.get("/offers/:restaurantId", async (c) => {
  try {
    const restaurantId = c.req.param("restaurantId");
    const offers = await offerRepository.findActive(restaurantId);

    // Only expose safe fields to public
    const publicOffers = offers.map((o) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      discountType: o.discountType,
      discountValue: o.discountValue,
      minOrderAmount: o.minOrderAmount,
      menuItemIds: o.menuItemIds,
      categoryIds: o.categoryIds,
      daysOfWeek: o.daysOfWeek,
      startTime: o.startTime,
      endTime: o.endTime,
      startDate: o.startDate,
      endDate: o.endDate,
      requiresCode: !!o.promoCode,
    }));

    return success(c, publicOffers, "Active offers fetched");
  } catch (err) {
    logger.error("GET /public/offers/:restaurantId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /public/orders — create order from customer
publicRoutes.post("/orders", rateLimit(10, 5 * 60 * 1000), async (c) => {
  try {
    const { tableId, customerPhone, customerName, specialNote, promoCode, items } =
      await c.req.json();

    if (!tableId || !items?.length) {
      return validationError(c, "tableId and items are required");
    }

    if (!customerPhone?.trim()) {
      return validationError(c, "Phone number is required");
    }

    // Validate phone: exactly 10 digits (Indian mobile), optional +91 prefix
    const cleanPhone = String(customerPhone).replace(/[\s\-()]/g, "").replace(/^\+91/, "");
    if (!/^\d{10}$/.test(cleanPhone)) {
      return validationError(c, "Phone number must be exactly 10 digits");
    }

    // Validate customer name length
    if (customerName && String(customerName).length > 100) {
      return validationError(c, "Customer name too long (max 100 chars)");
    }

    // Validate special note length
    if (specialNote && String(specialNote).length > 500) {
      return validationError(c, "Special note too long (max 500 chars)");
    }

    // Validate items array
    if (!Array.isArray(items) || items.length > 50) {
      return validationError(c, "Invalid items (max 50 items per order)");
    }

    for (const item of items) {
      if (!item.menuItemId || typeof item.menuItemId !== "string") {
        return validationError(c, "Each item must have a valid menuItemId");
      }
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return validationError(c, "Item quantity must be between 1 and 99");
      }
    }

    const order = await orderService.createOrder({
      tableId,
      customerPhone: cleanPhone,
      customerName,
      specialNote,
      promoCode: promoCode?.trim(),
      items,
    });

    return success(c, order, "Order placed");
  } catch (err) {
    if (err instanceof OrderError) {
      return validationError(c, err.message, err.code);
    }
    logger.error("POST /public/orders", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /public/orders/:orderId/items — add items to an existing order
publicRoutes.patch("/orders/:orderId/items", rateLimit(10, 5 * 60 * 1000), async (c) => {
  try {
    const orderId = c.req.param("orderId") as string;
    const { customerPhone, items } = await c.req.json();

    if (!customerPhone?.trim()) {
      return validationError(c, "Phone number is required");
    }

    const cleanPhone = String(customerPhone).replace(/[\s\-()]/g, "").replace(/^\+91/, "");
    if (!/^\d{10}$/.test(cleanPhone)) {
      return validationError(c, "Phone number must be exactly 10 digits");
    }

    if (!Array.isArray(items) || items.length === 0) {
      return validationError(c, "Items array is required");
    }

    if (items.length > 50) {
      return validationError(c, "Too many items (max 50 per request)");
    }

    for (const item of items) {
      if (!item.menuItemId || typeof item.menuItemId !== "string") {
        return validationError(c, "Each item must have a valid menuItemId");
      }
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return validationError(c, "Item quantity must be between 1 and 99");
      }
    }

    const order = await orderService.addItems({
      orderId,
      customerPhone: cleanPhone,
      items,
    });

    return success(c, order, "Items added to order");
  } catch (err) {
    if (err instanceof OrderError) {
      return validationError(c, err.message, err.code);
    }
    logger.error("PATCH /public/orders/:orderId/items", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/orders/active/:tableId — active (non-SETTLED) order on this table
publicRoutes.get("/orders/active/:tableId", async (c) => {
  try {
    const tableId = c.req.param("tableId");
    const order = await orderRepository.findActiveByTable(tableId);

    if (!order) {
      return success(c, { active: false, order: null }, "No active order");
    }
    return success(c, { active: true, order }, "Active order found");
  } catch (err) {
    logger.error("GET /public/orders/active/:tableId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/orders/active-by-phone/:phone — active orders for a phone number
publicRoutes.get("/orders/active-by-phone/:phone", async (c) => {
  try {
    const phone = c.req.param("phone").trim();
    if (!phone) return validationError(c, "Phone is required");

    const orders = await orderRepository.findActiveByPhone(phone);
    return success(c, { orders }, "Active orders fetched");
  } catch (err) {
    logger.error("GET /public/orders/active-by-phone/:phone", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/orders/history/:phone — order history by phone number
publicRoutes.get("/orders/history/:phone", async (c) => {
  try {
    const phone = c.req.param("phone").trim();
    if (!phone) return validationError(c, "Phone is required");

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));

    const [orders, total] = await orderRepository.findHistory(phone, page, limit);

    return success(c, {
      orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }, "Order history fetched");
  } catch (err) {
    logger.error("GET /public/orders/history/:phone", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/orders/:orderId — single order for tracking
publicRoutes.get("/orders/:orderId", async (c) => {
  try {
    const orderId = c.req.param("orderId");
    const order = await orderRepository.findByIdWithRestaurant(orderId);

    if (!order) {
      return validationError(c, "Order not found");
    }
    return success(c, order, "Order fetched");
  } catch (err) {
    logger.error("GET /public/orders/:orderId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /public/ratings — submit ratings for menu items
publicRoutes.post("/ratings", async (c) => {
  try {
    const { orderId, ratings } = await c.req.json();

    if (!orderId || !ratings?.length) {
      return validationError(c, "orderId and ratings are required");
    }

    const order = await orderRepository.findByIdWithItems(orderId);

    if (!order) {
      return validationError(c, "Order not found");
    }

    if (order.status !== ORDER_STATUS.BILLED && order.status !== ORDER_STATUS.SETTLED) {
      return validationError(c, "Order must be billed or settled to rate");
    }

    if (!order.customerId) {
      return validationError(c, "No customer linked to this order");
    }

    const orderMenuItemIds = new Set(order.items.map((i) => i.menuItemId));
    for (const r of ratings) {
      if (!r.menuItemId || typeof r.rating !== "number" || r.rating < 1 || r.rating > 5) {
        return validationError(c, "Each rating must have menuItemId and rating (1-5)");
      }
      if (!orderMenuItemIds.has(r.menuItemId)) {
        return validationError(c, `Item ${r.menuItemId} is not part of this order`);
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const r of ratings as { menuItemId: string; rating: number; note?: string }[]) {
        await ratingRepository.createWithRecalc(
          {
            orderId,
            menuItemId: r.menuItemId,
            restaurantId: order.restaurantId,
            customerId: order.customerId!,
            rating: r.rating,
            note: r.note || "",
          },
          tx as never
        );

        const agg = await ratingRepository.aggregateByMenuItem(r.menuItemId, tx as never);

        await menuRepository.updateItem(r.menuItemId, {
          averageRating: Math.round((agg._avg.rating || 0) * 10) / 10,
          ratingCount: agg._count.rating,
        });
      }
    });

    return success(c, null, "Ratings submitted");
  } catch (err) {
    logger.error("POST /public/ratings", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /public/ratings/:menuItemId — get ratings with notes for a menu item
publicRoutes.get("/ratings/:menuItemId", async (c) => {
  try {
    const menuItemId = c.req.param("menuItemId");
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "10", 10)));
    const starFilter = c.req.query("star") ? parseInt(c.req.query("star")!, 10) : undefined;

    const where: { menuItemId: string; rating?: number } = { menuItemId };
    if (starFilter && starFilter >= 1 && starFilter <= 5) {
      where.rating = starFilter;
    }

    const [ratings, total] = await ratingRepository.findMany(where, page, limit);

    return success(c, {
      ratings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }, "Ratings fetched");
  } catch (err) {
    logger.error("GET /public/ratings/:menuItemId", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
