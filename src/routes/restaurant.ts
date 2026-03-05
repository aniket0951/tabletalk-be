import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import type { Env } from "../types";

export const restaurantRoutes = new Hono<Env>();

restaurantRoutes.use("*", ownerAuth);

// GET /restaurant
restaurantRoutes.get("/", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
      include: { _count: { select: { tables: true } } },
    });

    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    return c.json({
      id: restaurant.id,
      name: restaurant.name,
      phone: restaurant.phone,
      city: restaurant.city,
      upiId: restaurant.upiId,
      serviceMode: restaurant.serviceMode,
      restaurantCode: restaurant.restaurantCode,
      tableCount: restaurant._count.tables,
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /restaurant
restaurantRoutes.patch("/", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const body = await c.req.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.city !== undefined) data.city = body.city;
    if (body.upiId !== undefined) data.upiId = body.upiId;
    if (body.serviceMode !== undefined) {
      if (!["DINE_IN", "WALK_IN"].includes(body.serviceMode)) {
        return c.json({ error: "Invalid serviceMode" }, 400);
      }
      data.serviceMode = body.serviceMode;
    }

    const updated = await prisma.restaurant.update({
      where: { id: restaurant.id },
      data,
    });

    return c.json({
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      city: updated.city,
      upiId: updated.upiId,
      serviceMode: updated.serviceMode,
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /restaurant
restaurantRoutes.post("/", async (c) => {
  try {
    const userId = c.get("userId");
    const body = await c.req.json();

    if (!body.name || !body.phone) {
      return c.json({ error: "Name and phone are required" }, 400);
    }

    const restaurant = await prisma.restaurant.create({
      data: {
        name: body.name,
        phone: body.phone,
        city: body.city || "",
        serviceMode: body.serviceMode || "DINE_IN",
        userId,
      },
    });

    return c.json({ id: restaurant.id, name: restaurant.name });
  } catch (error) {
    console.log("Create Restaurant Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /restaurant/code
restaurantRoutes.post("/code", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    function generateCode(): string {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      return code;
    }

    let code = generateCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.restaurant.findFirst({ where: { restaurantCode: code } });
      if (!existing || existing.id === restaurant.id) break;
      code = generateCode();
      attempts++;
    }

    const updated = await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { restaurantCode: code },
    });

    return c.json({ restaurantCode: updated.restaurantCode });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
