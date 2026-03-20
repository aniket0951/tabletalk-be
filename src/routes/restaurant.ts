import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { createOwnerToken } from "../lib/jwt";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const restaurantRoutes = new Hono<Env>();

restaurantRoutes.use("*", ownerAuth);

// GET /restaurant
restaurantRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { _count: { select: { tables: true } } },
    });

    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    return c.json({
      id: restaurantId,
      name: restaurant.name,
      phone: restaurant.phone,
      city: restaurant.city,
      upiId: restaurant.upiId,
      serviceMode: restaurant.serviceMode,
      restaurantCode: restaurant.restaurantCode,
      tableCount: restaurant._count.tables,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Server error", detail: message }, 500);
  }
});

// PATCH /restaurant
restaurantRoutes.patch("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

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
      where: { id: restaurantId },
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Server error", detail: message }, 500);
  }
});

// POST /restaurant
restaurantRoutes.post("/", async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);
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

    // Re-issue token with restaurantId so subsequent requests don't need DB lookup
    const email = c.get(CTX.EMAIL);
    const newToken = await createOwnerToken({ userId, email, restaurantId: restaurant.id });

    return c.json({ id: restaurant.id, name: restaurant.name, token: newToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Server error", detail: message }, 500);
  }
});

// POST /restaurant/code
restaurantRoutes.post("/code", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    function generateCode(): string {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += chars[bytes[i] % chars.length];
      }
      return code;
    }

    let code = generateCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.restaurant.findFirst({ where: { restaurantCode: code } });
      if (!existing || existing.id === restaurantId) break;
      code = generateCode();
      attempts++;
    }

    const updated = await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { restaurantCode: code },
    });

    return c.json({ restaurantCode: updated.restaurantCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Server error", detail: message }, 500);
  }
});
