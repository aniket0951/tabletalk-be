import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { rateLimit } from "../middleware/rate-limit";
import { ORDER_STATUS } from "../lib/constants";
import { orderRepository } from "../repositories/order.repository";
import { tableRepository } from "../repositories/table.repository";
import { menuRepository } from "../repositories/menu.repository";
import { ratingRepository } from "../repositories/rating.repository";
import { orderService, OrderError } from "../services/order.service";

export const publicRoutes = new Hono();

// GET /public/table/:tableId — table info + restaurant name
publicRoutes.get("/table/:tableId", async (c) => {
  try {
    const tableId = c.req.param("tableId");

    const table = await tableRepository.findByIdWithRestaurant(tableId);

    if (!table || table.isDeleted) {
      return c.json({ error: "Table not found" }, 404);
    }

    return c.json({
      id: table.id,
      tableNumber: table.tableNumber,
      label: table.label,
      capacity: table.capacity,
      restaurant: table.restaurant,
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /public/menu/:restaurantId — categories only (no items)
publicRoutes.get("/menu/:restaurantId", async (c) => {
  try {
    const restaurantId = c.req.param("restaurantId");
    const categories = await menuRepository.findPublicCategories(restaurantId);
    return c.json(categories);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /public/menu/:restaurantId/category/:categoryId — items for one category
publicRoutes.get("/menu/:restaurantId/category/:categoryId", async (c) => {
  try {
    const restaurantId = c.req.param("restaurantId");
    const categoryId = c.req.param("categoryId");

    const category = await menuRepository.findCategoryByIdAndRestaurant(categoryId, restaurantId);
    if (!category) return c.json({ error: "Category not found" }, 404);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));

    const items = await menuRepository.findAvailableItems(categoryId, page, limit);

    return c.json(items);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /public/orders — create order from customer
publicRoutes.post("/orders", rateLimit(10, 5 * 60 * 1000), async (c) => {
  try {
    const { tableId, customerPhone, customerName, specialNote, items } =
      await c.req.json();

    if (!tableId || !items?.length) {
      return c.json({ error: "tableId and items are required" }, 400);
    }

    if (!customerPhone?.trim()) {
      return c.json({ error: "Phone number is required" }, 400);
    }

    // Validate phone: exactly 10 digits (Indian mobile), optional +91 prefix
    const cleanPhone = String(customerPhone).replace(/[\s\-()]/g, "").replace(/^\+91/, "");
    if (!/^\d{10}$/.test(cleanPhone)) {
      return c.json({ error: "Phone number must be exactly 10 digits" }, 400);
    }

    // Validate customer name length
    if (customerName && String(customerName).length > 100) {
      return c.json({ error: "Customer name too long (max 100 chars)" }, 400);
    }

    // Validate special note length
    if (specialNote && String(specialNote).length > 500) {
      return c.json({ error: "Special note too long (max 500 chars)" }, 400);
    }

    // Validate items array
    if (!Array.isArray(items) || items.length > 50) {
      return c.json({ error: "Invalid items (max 50 items per order)" }, 400);
    }

    for (const item of items) {
      if (!item.menuItemId || typeof item.menuItemId !== "string") {
        return c.json({ error: "Each item must have a valid menuItemId" }, 400);
      }
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return c.json({ error: "Item quantity must be between 1 and 99" }, 400);
      }
    }

    const order = await orderService.createOrder({
      tableId,
      customerPhone: cleanPhone,
      customerName,
      specialNote,
      items,
    });

    return c.json(order, 201);
  } catch (err) {
    if (err instanceof OrderError) {
      const body: Record<string, string> = { error: err.message };
      if (err.code) body.code = err.code;
      return c.json(body, err.statusCode as 400);
    }
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /public/orders/active/:tableId — active (non-SETTLED) order on this table
publicRoutes.get("/orders/active/:tableId", async (c) => {
  try {
    const tableId = c.req.param("tableId");
    const order = await orderRepository.findActiveByTable(tableId);

    if (!order) {
      return c.json({ active: false, order: null });
    }
    return c.json({ active: true, order });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /public/orders/active-by-phone/:phone — active orders for a phone number
publicRoutes.get("/orders/active-by-phone/:phone", async (c) => {
  try {
    const phone = c.req.param("phone").trim();
    if (!phone) return c.json({ error: "Phone is required" }, 400);

    const orders = await orderRepository.findActiveByPhone(phone);
    return c.json({ orders });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /public/orders/history/:phone — order history by phone number
publicRoutes.get("/orders/history/:phone", async (c) => {
  try {
    const phone = c.req.param("phone").trim();
    if (!phone) return c.json({ error: "Phone is required" }, 400);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));

    const [orders, total] = await orderRepository.findHistory(phone, page, limit);

    return c.json({
      orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /public/orders/:orderId — single order for tracking
publicRoutes.get("/orders/:orderId", async (c) => {
  try {
    const orderId = c.req.param("orderId");
    const order = await orderRepository.findByIdWithRestaurant(orderId);

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }
    return c.json(order);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /public/ratings — submit ratings for menu items
publicRoutes.post("/ratings", async (c) => {
  try {
    const { orderId, ratings } = await c.req.json();

    if (!orderId || !ratings?.length) {
      return c.json({ error: "orderId and ratings are required" }, 400);
    }

    const order = await orderRepository.findByIdWithItems(orderId);

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    if (order.status !== ORDER_STATUS.BILLED && order.status !== ORDER_STATUS.SETTLED) {
      return c.json({ error: "Order must be billed or settled to rate" }, 400);
    }

    if (!order.customerId) {
      return c.json({ error: "No customer linked to this order" }, 400);
    }

    const orderMenuItemIds = new Set(order.items.map((i) => i.menuItemId));
    for (const r of ratings) {
      if (!r.menuItemId || typeof r.rating !== "number" || r.rating < 1 || r.rating > 5) {
        return c.json({ error: "Each rating must have menuItemId and rating (1-5)" }, 400);
      }
      if (!orderMenuItemIds.has(r.menuItemId)) {
        return c.json({ error: `Item ${r.menuItemId} is not part of this order` }, 400);
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

    return c.json({ success: true, message: "Ratings submitted" });
  } catch {
    return c.json({ error: "Server error" }, 500);
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

    return c.json({
      ratings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
