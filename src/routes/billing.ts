import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX } from "../lib/constants";
import { subscriptionRepository } from "../repositories/subscription.repository";
import { invoiceRepository } from "../repositories/invoice.repository";
import { billingService, BillingError } from "../services/billing.service";

import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, validationError, serverError } from "../lib/response";

export const billingRoutes = new Hono<Env>();

// ── Protected routes ────────────────────────────────────────

const protectedRoutes = new Hono<Env>();
protectedRoutes.use("*", ownerAuth, requireRestaurant);

// GET /billing/subscription — get current subscription
protectedRoutes.get("/subscription", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const subscription = await subscriptionRepository.findLatest(restaurantId);
    if (!subscription) return validationError(c, "No subscription");

    const daysRemaining = subscription.endDate
      ? Math.max(
          0,
          Math.ceil(
            (new Date(subscription.endDate).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;

    return success(c, { ...subscription, daysRemaining }, "Subscription fetched");
  } catch (err) {
    logger.error("GET /billing/subscription", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /billing/subscription — create trial subscription (no payment)
protectedRoutes.post("/subscription", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const { plan } = await c.req.json();
    const subscription = await billingService.createTrialSubscription(restaurantId, plan);
    return success(c, subscription, "Trial started");
  } catch (err) {
    if (err instanceof BillingError) return validationError(c, err.message);
    logger.error("POST /billing/subscription", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /billing/checkout — create Razorpay order for one-time payment
protectedRoutes.post("/checkout", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const { plan } = await c.req.json();
    const result = await billingService.createCheckout(restaurantId, c.get(CTX.USER_ID), plan);
    return success(c, result, "Checkout created");
  } catch (err: any) {
    if (err instanceof BillingError) return validationError(c, err.message);
    logger.error("POST /billing/checkout", err);
    const detail = err?.error?.description || err?.message || String(err);
    return serverError(c, detail);
  }
});

// POST /billing/verify — verify payment after Razorpay checkout
protectedRoutes.post("/verify", async (c) => {
  try {
    const body = await c.req.json();
    const subscription = await billingService.verifyPayment(body);
    return success(c, { subscription }, "Payment verified");
  } catch (err) {
    if (err instanceof BillingError) return validationError(c, err.message);
    logger.error("POST /billing/verify", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /billing/cancel — cancel subscription
protectedRoutes.post("/cancel", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const subscription = await billingService.cancelSubscription(restaurantId);
    return success(c, { subscription }, "Subscription cancelled");
  } catch (err) {
    if (err instanceof BillingError) return validationError(c, err.message);
    logger.error("POST /billing/cancel", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /billing/invoices — list invoices
protectedRoutes.get("/invoices", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const invoices = await invoiceRepository.findByRestaurant(restaurantId);
    return success(c, invoices, "Invoices fetched");
  } catch (err) {
    logger.error("GET /billing/invoices", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// ── Webhook route (no auth — verified via signature) ────────

const webhookRoutes = new Hono();

webhookRoutes.post("/webhook", async (c) => {
  try {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-razorpay-signature");
    const result = await billingService.handleWebhook(rawBody, signature);
    return success(c, result, "Webhook processed");
  } catch (err) {
    if (err instanceof BillingError) return validationError(c, err.message);
    logger.error("POST /billing/webhook", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// ── Mount both ──────────────────────────────────────────────

billingRoutes.route("/", protectedRoutes);
billingRoutes.route("/", webhookRoutes);
