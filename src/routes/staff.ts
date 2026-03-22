import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, STAFF_ROLE } from "../lib/constants";
import { staffRepository } from "../repositories/staff.repository";
import { staffService } from "../services/staff.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";

export const staffRoutes = new Hono<Env>();

staffRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /staff
staffRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const staff = await staffRepository.findMany(restaurantId);
    return c.json(staff);
  } catch (err) {
    logger.error("GET /staff", err);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /staff
staffRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const { name, phone, pin, role } = await c.req.json();
    if (!name || !pin) {
      return c.json({ error: "Name and PIN are required" }, 400);
    }

    const pinError = staffService.validatePin(pin);
    if (pinError) return c.json({ error: pinError }, 400);

    const isUnique = await staffService.checkPinUniqueness(restaurantId, pin);
    if (!isUnique) {
      return c.json(
        { error: "PIN already in use by another staff member" },
        400,
      );
    }

    const pinHash = await staffService.hashPin(pin);
    const employeeId = await staffService.generateEmployeeId(restaurantId);

    const staff = await staffRepository.create({
      employeeId,
      name,
      phone: phone || "",
      pin: pinHash,
      role: role || STAFF_ROLE.WAITER,
      restaurantId,
    });

    return c.json(staff);
  } catch (err) {
    logger.error("POST /staff", err);
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /staff/:id
staffRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await staffRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return c.json({ error: "Not found" }, 404);
    }

    const { name, phone, pin, role } = await c.req.json();

    if (pin !== undefined) {
      const pinError = staffService.validatePin(pin);
      if (pinError) return c.json({ error: pinError }, 400);

      const isUnique = await staffService.checkPinUniqueness(
        restaurantId,
        pin,
        id,
      );
      if (!isUnique) {
        return c.json(
          { error: "PIN already in use by another staff member" },
          400,
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = String(name).slice(0, 100);
    if (phone !== undefined) data.phone = String(phone).slice(0, 20);
    if (pin !== undefined) data.pin = await staffService.hashPin(pin);
    if (role !== undefined) {
      if (![STAFF_ROLE.WAITER, STAFF_ROLE.CAPTAIN].includes(role)) {
        return c.json({ error: "Invalid role" }, 400);
      }
      data.role = role;
    }

    const staff = await staffRepository.update(id, data);

    return c.json(staff);
  } catch (err) {
    logger.error("PATCH /staff/:id", err);
    return c.json({ error: "Server error" }, 500);
  }
});

// DELETE /staff/:id
staffRoutes.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const existing = await staffRepository.findById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    await staffRepository.softDelete(id);

    return c.json({ success: true });
  } catch (err) {
    logger.error("DELETE /staff/:id", err);
    return c.json({ error: "Server error" }, 500);
  }
});
