import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import {
  getRazorpay,
  PLAN_PRICES,
  verifyOrderPaymentSignature,
  verifyWebhookSignature,
} from "../lib/razorpay";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const billingRoutes = new Hono<Env>();

// Helper: get latest subscription for a restaurant
async function getLatestSubscription(restaurantId: string) {
  return prisma.subscription.findFirst({
    where: { restaurantId, isDeleted: false },
    orderBy: { createdAt: "desc" },
  });
}

// ── Protected routes ────────────────────────────────────────

const protectedRoutes = new Hono<Env>();
protectedRoutes.use("*", ownerAuth);

// GET /billing/subscription — get current subscription
protectedRoutes.get("/subscription", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const subscription = await getLatestSubscription(restaurantId);
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
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const { plan } = await c.req.json();

    const validPlans = ["STARTER", "GROWTH", "MULTI"];
    if (!validPlans.includes(plan)) {
      return c.json({ error: "Invalid plan" }, 400);
    }

    // Check if there's already an active/trial subscription
    const existing = await getLatestSubscription(restaurantId);
    if (existing && ["TRIAL", "ACTIVE"].includes(existing.status)) {
      return c.json({ error: "Active subscription already exists" }, 400);
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    const subscription = await prisma.subscription.create({
      data: {
        plan,
        status: "TRIAL",
        startDate: new Date(),
        endDate,
        restaurantId,
      },
    });

    return c.json(subscription);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/checkout — create Razorpay order for one-time payment
protectedRoutes.post("/checkout", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const { plan } = await c.req.json();

    const validPlans = ["STARTER", "GROWTH", "MULTI"] as const;
    if (!validPlans.includes(plan)) {
      return c.json({ error: "Invalid plan" }, 400);
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: { user: true },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const amount = PLAN_PRICES[plan as keyof typeof PLAN_PRICES];

    // Create Razorpay order
    const rzpOrder = await getRazorpay().orders.create({
      amount,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        restaurant_id: restaurantId,
        user_id: c.get(CTX.USER_ID),
        plan,
      },
    });

    // Create subscription record in DB (PENDING until payment verified)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    const subscription = await prisma.subscription.create({
      data: {
        plan,
        status: "PENDING",
        startDate: new Date(),
        endDate,
        restaurantId,
        razorpaySubscriptionId: rzpOrder.id, // storing order ID here
      },
    });

    return c.json({
      subscriptionId: subscription.id,
      razorpayOrderId: rzpOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount,
      currency: "INR",
      name: restaurant.name,
      email: restaurant.user.email,
    });
  } catch (error: any) {
    const detail = error?.error?.description || error?.message || String(error);
    return c.json({ error: "Server error", detail }, 500);
  }
});

// POST /billing/verify — verify payment after Razorpay checkout
protectedRoutes.post("/verify", async (c) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = await c.req.json();

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return c.json({ error: "Missing payment details" }, 400);
    }

    const isValid = verifyOrderPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      return c.json({ error: "Invalid payment signature" }, 400);
    }

    // Find the subscription by Razorpay order ID
    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: razorpay_order_id },
    });

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    // Fetch payment details from Razorpay
    const rzpPayment = await getRazorpay().payments.fetch(razorpay_payment_id);

    const now = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);

    // Update subscription to ACTIVE
    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        paymentMethod: rzpPayment.method || null,
        currentPeriodStart: now,
        currentPeriodEnd: endDate,
        endDate,
      },
    });

    // Create invoice record
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${Date.now()}`,
        subscriptionId: subscription.id,
        amount: PLAN_PRICES[subscription.plan as keyof typeof PLAN_PRICES] / 100,
        status: "PAID",
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        paidAt: new Date(),
        paymentMethod: rzpPayment.method || null,
      },
    });

    return c.json({ success: true, subscription: updated });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/cancel — cancel subscription
protectedRoutes.post("/cancel", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const subscription = await getLatestSubscription(restaurantId);
    if (!subscription) return c.json({ error: "No subscription" }, 404);

    if (!["ACTIVE", "TRIAL"].includes(subscription.status)) {
      return c.json({ error: "No active subscription to cancel" }, 400);
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    return c.json({ success: true, subscription: updated });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /billing/invoices — list invoices
protectedRoutes.get("/invoices", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const invoices = await prisma.invoice.findMany({
      where: {
        subscription: { restaurantId, isDeleted: false },
        isDeleted: false,
      },
      orderBy: { createdAt: "desc" },
    });

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

    if (!signature || !verifyWebhookSignature(rawBody, signature)) {
      return c.json({ error: "Invalid signature" }, 400);
    }

    const event = JSON.parse(rawBody);

    // Log webhook for audit
    await prisma.razorpayWebhookLog.create({
      data: {
        eventType: event.event,
        payload: rawBody,
        processed: false,
      },
    });

    const eventType: string = event.event;
    const rzpPayment = event.payload?.payment?.entity;

    if (!rzpPayment?.order_id) {
      return c.json({ status: "ignored" });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: rzpPayment.order_id },
    });

    if (!subscription) {
      return c.json({ status: "subscription not found" });
    }

    switch (eventType) {
      case "payment.captured": {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);

        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "ACTIVE",
            paymentMethod: rzpPayment.method || null,
            currentPeriodStart: new Date(),
            currentPeriodEnd: endDate,
            endDate,
          },
        });
        break;
      }

      case "payment.failed": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "HALTED" },
        });
        break;
      }
    }

    // Mark webhook as processed
    await prisma.razorpayWebhookLog.updateMany({
      where: { eventType, processed: false },
      data: { processed: true },
    });

    return c.json({ status: "ok" });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// ── Mount both ──────────────────────────────────────────────

billingRoutes.route("/", protectedRoutes);
billingRoutes.route("/", webhookRoutes);
