import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { requireRestaurant } from "../middleware/require-restaurant";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { CTX } from "../lib/constants";
import { offerRepository } from "../repositories/offer.repository";
import { offerService } from "../services/offer.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const offerRoutes = new Hono<Env>();

offerRoutes.use("*", ownerAuth, requireRestaurant, subscriptionGuard);

// GET /offers
offerRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const offers = await offerRepository.findMany(restaurantId);
    return success(c, offers, "Offers fetched");
  } catch (err) {
    logger.error("GET /offers", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /offers
offerRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const body = await c.req.json();

    const error = offerService.validateOffer(body);
    if (error) return validationError(c, error);

    const offer = await offerRepository.create({
      restaurantId,
      name: body.name,
      type: body.type,
      discountType: body.discountType,
      discountValue: Number(body.discountValue),
      minOrderAmount: body.minOrderAmount != null ? Number(body.minOrderAmount) : null,
      maxDiscount: body.maxDiscount != null ? Number(body.maxDiscount) : null,
      menuItemIds: body.menuItemIds || [],
      categoryIds: body.categoryIds || [],
      daysOfWeek: body.daysOfWeek || [],
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      promoCode: body.promoCode || null,
      usageLimit: body.usageLimit != null ? Number(body.usageLimit) : null,
    });

    return success(c, offer, "Offer created");
  } catch (err) {
    logger.error("POST /offers", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// PATCH /offers/:id
offerRoutes.patch("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await offerRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId || existing.isDeleted) {
      return validationError(c, "Offer not found");
    }

    const body = await c.req.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = String(body.name);
    if (body.active !== undefined) data.active = Boolean(body.active);
    if (body.discountValue !== undefined) data.discountValue = Number(body.discountValue);
    if (body.minOrderAmount !== undefined) data.minOrderAmount = body.minOrderAmount != null ? Number(body.minOrderAmount) : null;
    if (body.maxDiscount !== undefined) data.maxDiscount = body.maxDiscount != null ? Number(body.maxDiscount) : null;
    if (body.menuItemIds !== undefined) data.menuItemIds = body.menuItemIds;
    if (body.categoryIds !== undefined) data.categoryIds = body.categoryIds;
    if (body.daysOfWeek !== undefined) data.daysOfWeek = body.daysOfWeek;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.promoCode !== undefined) data.promoCode = body.promoCode || null;
    if (body.usageLimit !== undefined) data.usageLimit = body.usageLimit != null ? Number(body.usageLimit) : null;

    const offer = await offerRepository.update(id, data);
    return success(c, offer, "Offer updated");
  } catch (err) {
    logger.error("PATCH /offers/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// DELETE /offers/:id
offerRoutes.delete("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await offerRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return validationError(c, "Offer not found");
    }

    await offerRepository.softDelete(id);
    return success(c, null, "Offer deleted");
  } catch (err) {
    logger.error("DELETE /offers/:id", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /offers/:id/stats
offerRoutes.get("/:id/stats", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const existing = await offerRepository.findById(id);
    if (!existing || existing.restaurantId !== restaurantId) {
      return validationError(c, "Offer not found");
    }

    const stats = await offerRepository.getStats(id);
    return success(c, {
      redemptions: stats._count,
      totalDiscountGiven: stats._sum.discountAmount || 0,
    }, "Offer stats fetched");
  } catch (err) {
    logger.error("GET /offers/:id/stats", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
