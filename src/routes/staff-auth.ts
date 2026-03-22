import { Hono } from "hono";
import { createStaffToken, setStaffCookie, clearStaffCookie } from "../lib/staff-jwt";
import { staffAuth } from "../middleware/staff-auth";
import { rateLimit } from "../middleware/rate-limit";
import { staffRepository } from "../repositories/staff.repository";
import { restaurantRepository } from "../repositories/restaurant.repository";
import { staffService } from "../services/staff.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, authError, serverError } from "../lib/response";

export const staffAuthRoutes = new Hono<Env>();

// POST /staff/auth/login — 5 attempts per 15 minutes (4-digit PIN is brute-forceable)
staffAuthRoutes.post("/login", rateLimit(5, 15 * 60 * 1000), async (c) => {
  try {
    const { restaurantCode, pin } = await c.req.json();

    if (!restaurantCode || !pin) {
      return validationError(c, "Restaurant code and PIN are required");
    }

    const restaurant = await restaurantRepository.findByCodeActive(restaurantCode);
    if (!restaurant) {
      return authError(c, "Invalid restaurant code");
    }

    const staff = await staffService.findStaffByPin(restaurant.id, pin);
    if (!staff) {
      return authError(c, "Invalid PIN");
    }

    const token = await createStaffToken({
      staffId: staff.id,
      restaurantId: restaurant.id,
      name: staff.name,
      role: staff.role,
    });

    setStaffCookie(c, token);

    return success(c, {
      token,
      staffId: staff.id,
      name: staff.name,
      role: staff.role,
      restaurantName: restaurant.name,
    }, "Staff logged in");
  } catch (err) {
    logger.error("POST /staff/auth/login", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /staff/auth/me
staffAuthRoutes.get("/me", staffAuth, async (c) => {
  try {
    const payload = c.get("staff");

    const staff = await staffRepository.findById(payload.staffId);
    if (!staff) {
      return authError(c, "Staff not found");
    }

    const restaurant = await restaurantRepository.findByIdBasic(payload.restaurantId);

    return success(c, {
      staffId: staff.id,
      name: staff.name,
      role: staff.role,
      restaurantId: payload.restaurantId,
      restaurantName: restaurant?.name || "",
    }, "Staff profile fetched");
  } catch (err) {
    logger.error("GET /staff/auth/me", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /staff/auth/logout
staffAuthRoutes.post("/logout", staffAuth, async (c) => {
  try {
    clearStaffCookie(c);
    return success(c, null, "Logged out");
  } catch (err) {
    logger.error("POST /staff/auth/logout", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
