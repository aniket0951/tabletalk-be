import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { createOwnerToken } from "../lib/jwt";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, SERVICE_MODE } from "../lib/constants";
import { restaurantRepository } from "../repositories/restaurant.repository";
import { restaurantService } from "../services/restaurant.service";
import type { Env } from "../types";

export const restaurantRoutes = new Hono<Env>();

restaurantRoutes.use("*", ownerAuth);

// GET /restaurant
restaurantRoutes.get("/", requireRestaurant, async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const restaurant = await restaurantRepository.findById(restaurantId);
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
restaurantRoutes.patch("/", requireRestaurant, async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const body = await c.req.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.city !== undefined) data.city = body.city;
    if (body.upiId !== undefined) data.upiId = body.upiId;
    if (body.serviceMode !== undefined) {
      if (![SERVICE_MODE.DINE_IN, SERVICE_MODE.WALK_IN].includes(body.serviceMode)) {
        return c.json({ error: "Invalid serviceMode" }, 400);
      }
      data.serviceMode = body.serviceMode;
    }

    const updated = await restaurantRepository.update(restaurantId, data);

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

    const restaurant = await restaurantRepository.create({
      name: body.name,
      phone: body.phone,
      city: body.city || "",
      serviceMode: body.serviceMode || SERVICE_MODE.DINE_IN,
      userId,
    });

    const email = c.get(CTX.EMAIL);
    const newToken = await createOwnerToken({ userId, email, restaurantId: restaurant.id });

    return c.json({ id: restaurant.id, name: restaurant.name, token: newToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Server error", detail: message }, 500);
  }
});

// POST /restaurant/code
restaurantRoutes.post("/code", requireRestaurant, async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const code = await restaurantService.generateRestaurantCode(restaurantId);

    const updated = await restaurantRepository.update(restaurantId, { restaurantCode: code });

    return c.json({ restaurantCode: updated.restaurantCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "Server error", detail: message }, 500);
  }
});
