import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, STAFF_ROLE } from "../lib/constants";

import { staffRepository } from "../repositories/staff.repository";
import { staffService } from "../services/staff.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const staffRoutes = new Hono<Env>();

staffRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /staff
staffRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const staff = await staffRepository.findMany(restaurantId);
    return success(c, staff, "Staff fetched");
  } catch (err) {
    logger.error("GET /staff", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /staff
staffRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const { name, phone, pin, role } = await c.req.json();
    if (!name || !pin) {
      return validationError(c, "Name and PIN are required");
    }

    const pinError = staffService.validatePin(pin);
    if (pinError) return validationError(c, pinError);

    const isUnique = await staffService.checkPinUniqueness(restaurantId, pin);
    if (!isUnique) {
      return validationError(c, "PIN already in use by another staff member");
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

    return success(c, staff, "Staff created");
  } catch (err) {
    logger.error("POST /staff", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /staff/:id
staffRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await staffRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return validationError(c, "Not found");
    }

    const { name, phone, pin, role } = await c.req.json();

    if (pin !== undefined) {
      const pinError = staffService.validatePin(pin);
      if (pinError) return validationError(c, pinError);

      const isUnique = await staffService.checkPinUniqueness(
        restaurantId,
        pin,
        id,
      );
      if (!isUnique) {
        return validationError(c, "PIN already in use by another staff member");
      }
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = String(name).slice(0, 100);
    if (phone !== undefined) data.phone = String(phone).slice(0, 20);
    if (pin !== undefined) data.pin = await staffService.hashPin(pin);
    if (role !== undefined) {
      if (![STAFF_ROLE.WAITER, STAFF_ROLE.CAPTAIN].includes(role)) {
        return validationError(c, "Invalid role");
      }
      data.role = role;
    }

    const staff = await staffRepository.update(id, data);

    return success(c, staff, "Staff updated");
  } catch (err) {
    logger.error("PATCH /staff/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// DELETE /staff/:id
staffRoutes.delete("/:id", async (c) => {
  try {
    const id = c.req.param("id");

    const existing = await staffRepository.findById(id);
    if (!existing) {
      return validationError(c, "Not found");
    }

    await staffRepository.softDelete(id);

    return success(c, null, "Staff deleted");
  } catch (err) {
    logger.error("DELETE /staff/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
