import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { createStaffToken, setStaffCookie, clearStaffCookie } from "../lib/staff-jwt";
import { staffAuth } from "../middleware/staff-auth";
import { rateLimit } from "../middleware/rate-limit";
import { staffService } from "../services/staff.service";
import type { Env } from "../types";

export const staffAuthRoutes = new Hono<Env>();

// POST /staff/auth/login — 5 attempts per 15 minutes (4-digit PIN is brute-forceable)
staffAuthRoutes.post("/login", rateLimit(5, 15 * 60 * 1000), async (c) => {
  try {
    const { restaurantCode, pin } = await c.req.json();

    if (!restaurantCode || !pin) {
      return c.json({ error: "Restaurant code and PIN are required" }, 400);
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { restaurantCode, isDeleted: false },
    });
    if (!restaurant) {
      return c.json({ error: "Invalid restaurant code" }, 401);
    }

    const staff = await staffService.findStaffByPin(restaurant.id, pin);
    if (!staff) {
      return c.json({ error: "Invalid PIN" }, 401);
    }

    const token = await createStaffToken({
      staffId: staff.id,
      restaurantId: restaurant.id,
      name: staff.name,
      role: staff.role,
    });

    setStaffCookie(c, token);

    return c.json({
      token,
      staffId: staff.id,
      name: staff.name,
      role: staff.role,
      restaurantName: restaurant.name,
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /staff/auth/me
staffAuthRoutes.get("/me", staffAuth, async (c) => {
  try {
    const payload = c.get("staff");

    const staff = await prisma.staff.findUnique({
      where: { id: payload.staffId },
    });
    if (!staff || staff.isDeleted) {
      return c.json({ error: "Staff not found" }, 401);
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: payload.restaurantId },
    });

    return c.json({
      staffId: staff.id,
      name: staff.name,
      role: staff.role,
      restaurantId: payload.restaurantId,
      restaurantName: restaurant?.name || "",
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /staff/auth/logout
staffAuthRoutes.post("/logout", staffAuth, async (c) => {
  try {
    clearStaffCookie(c);
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
