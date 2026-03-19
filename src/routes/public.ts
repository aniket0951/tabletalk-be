import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { emitSocketEvent } from "../lib/socket";
import { upsertCustomer } from "../lib/customer";
import { rateLimit } from "../middleware/rate-limit";

export const publicRoutes = new Hono();

// GET /public/table/:tableId — table info + restaurant name
publicRoutes.get("/table/:tableId", async (c) => {
  try {
    const tableId = c.req.param("tableId");

    const table = await prisma.diningTable.findUnique({
      where: { id: tableId },
      include: { restaurant: { select: { id: true, name: true } } },
    });

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

// GET /public/menu/:restaurantId — categories with available items
publicRoutes.get("/menu/:restaurantId", async (c) => {
  try {
    const restaurantId = c.req.param("restaurantId");

    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId },
      include: {
        items: {
          where: { available: true, isDeleted: false },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            type: true,
            available: true,
            categoryId: true,
            restaurantId: true,
            averageRating: true,
            ratingCount: true,
          },
          orderBy: { averageRating: "desc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return c.json(categories);
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

    // Validate phone format (10-15 digits, optional + prefix)
    const cleanPhone = String(customerPhone).replace(/[\s\-()]/g, "");
    if (!/^\+?\d{10,15}$/.test(cleanPhone)) {
      return c.json({ error: "Invalid phone number format" }, 400);
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

    // Get table + restaurant
    const table = await prisma.diningTable.findUnique({
      where: { id: tableId },
      include: { restaurant: true },
    });

    if (!table || table.isDeleted) {
      return c.json({ error: "Table not found" }, 404);
    }

    const restaurantId = table.restaurantId;

    // Fetch menu items to get prices
    const menuItemIds = items.map((i: { menuItemId: string }) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, available: true, isDeleted: false },
    });

    if (menuItems.length !== menuItemIds.length) {
      return c.json({ error: "Some items are unavailable" }, 400);
    }

    const priceMap = new Map(menuItems.map((mi) => [mi.id, mi.price]));

    // Calculate totals
    let subtotal = 0;
    const orderItems = items.map(
      (i: { menuItemId: string; quantity: number }) => {
        const unitPrice = priceMap.get(i.menuItemId)!;
        const qty = Math.floor(Number(i.quantity));
        subtotal += unitPrice * qty;
        return {
          menuItemId: i.menuItemId,
          quantity: qty,
          unitPrice,
        };
      }
    );

    const tax = Math.round(subtotal * 0.05 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    // Generate order code
    const lastOrder = await prisma.order.findFirst({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
    });

    let nextNum = 1;
    if (lastOrder?.orderCode) {
      const match = lastOrder.orderCode.match(/\d+/);
      if (match) nextNum = parseInt(match[0], 10) + 1;
    }
    const orderCode = `ORD${String(nextNum).padStart(3, "0")}`;

    // Upsert customer
    const customerId = await upsertCustomer({
      restaurantId,
      phone: customerPhone.trim(),
      name: customerName || undefined,
      orderTotal: total,
    });

    // Create order + items in transaction
    const order = await prisma.order.create({
      data: {
        orderCode,
        tableId,
        restaurantId,
        customerPhone: customerPhone.trim(),
        customerName: customerName || "",
        customerId,
        specialNote: specialNote || "",
        subtotal,
        tax,
        total,
        status: "NEW",
        items: { create: orderItems },
      },
      include: {
        items: { include: { menuItem: true } },
        table: true,
        staff: true,
      },
    });

    // Set table to OCCUPIED
    await prisma.diningTable.update({
      where: { id: tableId },
      data: { status: "OCCUPIED" },
    });

    emitSocketEvent("order:created", order);
    emitSocketEvent("table:updated", { ...table, status: "OCCUPIED" });

    return c.json(order, 201);
  } catch (error) {
    console.error("[POST /public/orders] error:", error);
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

    const where = { customerPhone: phone };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: { include: { menuItem: true } },
          table: true,
          restaurant: { select: { id: true, name: true } },
        },
        orderBy: { placedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

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

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { menuItem: true } },
        table: true,
        staff: true,
        restaurant: { select: { id: true, name: true, phone: true } },
      },
    });

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

    // Validate order exists and is BILLED or SETTLED
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    if (order.status !== "BILLED" && order.status !== "SETTLED") {
      return c.json({ error: "Order must be billed or settled to rate" }, 400);
    }

    if (!order.customerId) {
      return c.json({ error: "No customer linked to this order" }, 400);
    }

    // Validate all menu item IDs belong to this order
    const orderMenuItemIds = new Set(order.items.map((i) => i.menuItemId));
    for (const r of ratings) {
      if (!r.menuItemId || typeof r.rating !== "number" || r.rating < 1 || r.rating > 5) {
        return c.json({ error: "Each rating must have menuItemId and rating (1-5)" }, 400);
      }
      if (!orderMenuItemIds.has(r.menuItemId)) {
        return c.json({ error: `Item ${r.menuItemId} is not part of this order` }, 400);
      }
    }

    // Create ratings and update averages in a transaction
    await prisma.$transaction(async (tx) => {
      for (const r of ratings as { menuItemId: string; rating: number; note?: string }[]) {
        // Create the rating record
        await tx.menuItemRating.create({
          data: {
            orderId,
            menuItemId: r.menuItemId,
            restaurantId: order.restaurantId,
            customerId: order.customerId!,
            rating: r.rating,
            note: r.note || "",
          },
        });

        // Recalculate average rating for this menu item
        const agg = await tx.menuItemRating.aggregate({
          where: { menuItemId: r.menuItemId },
          _avg: { rating: true },
          _count: { rating: true },
        });

        await tx.menuItem.update({
          where: { id: r.menuItemId },
          data: {
            averageRating: Math.round((agg._avg.rating || 0) * 10) / 10,
            ratingCount: agg._count.rating,
          },
        });
      }
    });

    return c.json({ success: true, message: "Ratings submitted" });
  } catch (error) {
    console.error("[POST /public/ratings] error:", error);
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

    const [ratings, total] = await Promise.all([
      prisma.menuItemRating.findMany({
        where,
        select: {
          rating: true,
          note: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.menuItemRating.count({ where }),
    ]);

    return c.json({
      ratings,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
