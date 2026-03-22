import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { createOwnerToken } from "../lib/jwt";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, SERVICE_MODE } from "../lib/constants";
import { restaurantRepository } from "../repositories/restaurant.repository";
import { restaurantService } from "../services/restaurant.service";
import type { Env } from "../types";
import { success, validationError, serverError } from "../lib/response";

export const restaurantRoutes = new Hono<Env>();

restaurantRoutes.use("*", ownerAuth);

// GET /restaurant
restaurantRoutes.get("/", requireRestaurant, async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const restaurant = await restaurantRepository.findById(restaurantId);
    if (!restaurant) return validationError(c, "No restaurant");

    return success(c, {
      id: restaurantId,
      name: restaurant.name,
      phone: restaurant.phone,
      city: restaurant.city,
      upiId: restaurant.upiId,
      serviceMode: restaurant.serviceMode,
      restaurantCode: restaurant.restaurantCode,
      tableCount: restaurant._count.tables,
    }, "Restaurant fetched");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(c, message);
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
      if (
        ![SERVICE_MODE.DINE_IN, SERVICE_MODE.WALK_IN].includes(body.serviceMode)
      ) {
        return validationError(c, "Invalid serviceMode");
      }
      data.serviceMode = body.serviceMode;
    }

    const updated = await restaurantRepository.update(restaurantId, data);

    return success(c, {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      city: updated.city,
      upiId: updated.upiId,
      serviceMode: updated.serviceMode,
    }, "Restaurant updated");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(c, message);
  }
});

// POST /restaurant
restaurantRoutes.post("/", async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);
    const body = await c.req.json();

    if (!body.name || !body.phone) {
      return validationError(c, "Name and phone are required");
    }

    const restaurant = await restaurantRepository.create({
      name: body.name,
      phone: body.phone,
      city: body.city || "",
      serviceMode: body.serviceMode || SERVICE_MODE.DINE_IN,
      userId,
    });

    const email = c.get(CTX.EMAIL);
    const newToken = await createOwnerToken({
      userId,
      email,
      restaurantId: restaurant.id,
    });

    return success(c, {
      id: restaurant.id,
      name: restaurant.name,
      token: newToken,
    }, "Restaurant created");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(c, message);
  }
});

// POST /restaurant/code
restaurantRoutes.post("/code", requireRestaurant, async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const code = await restaurantService.generateRestaurantCode(restaurantId);

    const updated = await restaurantRepository.update(restaurantId, {
      restaurantCode: code,
    });

    return success(c, { restaurantCode: updated.restaurantCode }, "Restaurant code generated");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(c, message);
  }
});
