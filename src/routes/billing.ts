import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX } from "../lib/constants";
import { subscriptionRepository } from "../repositories/subscription.repository";
import { invoiceRepository } from "../repositories/invoice.repository";
import { billingService, BillingError } from "../services/billing.service";
import type { Env } from "../types";

export const billingRoutes = new Hono<Env>();

// ── Protected routes ────────────────────────────────────────

const protectedRoutes = new Hono<Env>();
protectedRoutes.use("*", ownerAuth, requireRestaurant);

// GET /billing/subscription — get current subscription
protectedRoutes.get("/subscription", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const subscription = await subscriptionRepository.findLatest(restaurantId);
    if (!subscription) return c.json({ error: "No subscription" }, 404);

    const daysRemaining = subscription.endDate
      ? Math.max(
          0,
          Math.ceil(
            (new Date(subscription.endDate).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : null;

    return c.json({ ...subscription, daysRemaining });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/subscription — create trial subscription (no payment)
protectedRoutes.post("/subscription", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const { plan } = await c.req.json();
    const subscription = await billingService.createTrialSubscription(restaurantId, plan);
    return c.json(subscription);
  } catch (err) {
    if (err instanceof BillingError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/checkout — create Razorpay order for one-time payment
protectedRoutes.post("/checkout", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const { plan } = await c.req.json();
    const result = await billingService.createCheckout(restaurantId, c.get(CTX.USER_ID), plan);
    return c.json(result);
  } catch (err: any) {
    if (err instanceof BillingError) return c.json({ error: err.message }, err.statusCode as 400);
    const detail = err?.error?.description || err?.message || String(err);
    return c.json({ error: "Server error", detail }, 500);
  }
});

// POST /billing/verify — verify payment after Razorpay checkout
protectedRoutes.post("/verify", async (c) => {
  try {
    const body = await c.req.json();
    const subscription = await billingService.verifyPayment(body);
    return c.json({ success: true, subscription });
  } catch (err) {
    if (err instanceof BillingError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/cancel — cancel subscription
protectedRoutes.post("/cancel", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const subscription = await billingService.cancelSubscription(restaurantId);
    return c.json({ success: true, subscription });
  } catch (err) {
    if (err instanceof BillingError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /billing/invoices — list invoices
protectedRoutes.get("/invoices", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const invoices = await invoiceRepository.findByRestaurant(restaurantId);
    return c.json(invoices);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// ── Webhook route (no auth — verified via signature) ────────

const webhookRoutes = new Hono();

webhookRoutes.post("/webhook", async (c) => {
  try {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-razorpay-signature");
    const result = await billingService.handleWebhook(rawBody, signature);
    return c.json(result);
  } catch (err) {
    if (err instanceof BillingError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// ── Mount both ──────────────────────────────────────────────

billingRoutes.route("/", protectedRoutes);
billingRoutes.route("/", webhookRoutes);
