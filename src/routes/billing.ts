import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import {
  getRazorpay,
  RAZORPAY_PLAN_IDS,
  PLAN_PRICES,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "../lib/razorpay";
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
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });

    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const subscription = await getLatestSubscription(restaurant.id);
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
    const userId = c.get("userId");
    const { plan } = await c.req.json();

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const validPlans = ["STARTER", "GROWTH", "MULTI"];
    if (!validPlans.includes(plan)) {
      return c.json({ error: "Invalid plan" }, 400);
    }

    // Check if there's already an active/trial subscription
    const existing = await getLatestSubscription(restaurant.id);
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
        restaurantId: restaurant.id,
      },
    });

    return c.json(subscription);
  } catch (error) {
    console.log("Subscription Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/checkout — create Razorpay subscription for payment
protectedRoutes.post("/checkout", async (c) => {
  try {
    const userId = c.get("userId");
    const { plan } = await c.req.json();

    const validPlans = ["STARTER", "GROWTH", "MULTI"] as const;
    if (!validPlans.includes(plan)) {
      return c.json({ error: "Invalid plan" }, 400);
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
      include: { user: true },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const razorpayPlanId =
      RAZORPAY_PLAN_IDS[plan as keyof typeof RAZORPAY_PLAN_IDS];

    // Create Razorpay subscription
    const rzpSubscription = await getRazorpay().subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: 120, // 10 years of monthly billing
      customer_notify: 1,
      notes: {
        restaurant_id: restaurant.id,
        user_id: userId,
        plan,
      },
    });

    // Create subscription record in DB
    const subscription = await prisma.subscription.create({
      data: {
        plan,
        status: "PENDING",
        startDate: new Date(),
        endDate: new Date(), // will be updated by webhook on activation
        restaurantId: restaurant.id,
        razorpaySubscriptionId: rzpSubscription.id,
        razorpayPlanId,
        razorpayShortUrl: rzpSubscription.short_url || null,
      },
    });

    return c.json({
      subscriptionId: subscription.id,
      razorpaySubscriptionId: rzpSubscription.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: PLAN_PRICES[plan as keyof typeof PLAN_PRICES],
      currency: "INR",
      name: restaurant.name,
      email: restaurant.user.email,
    });
  } catch (error: any) {
    console.log("Checkout Error:", error);
    const detail = error?.error?.description || error?.message || String(error);
    return c.json({ error: "Server error", detail }, 500);
  }
});

// POST /billing/verify — verify payment after Razorpay checkout
protectedRoutes.post("/verify", async (c) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    } = await c.req.json();

    if (
      !razorpay_payment_id ||
      !razorpay_subscription_id ||
      !razorpay_signature
    ) {
      return c.json({ error: "Missing payment details" }, 400);
    }

    const isValid = verifyPaymentSignature(
      razorpay_subscription_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      return c.json({ error: "Invalid payment signature" }, 400);
    }

    // Find the subscription by Razorpay ID
    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: razorpay_subscription_id },
    });

    if (!subscription) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    // Fetch subscription details from Razorpay
    const rzpSub = await getRazorpay().subscriptions.fetch(
      razorpay_subscription_id
    );

    const currentEnd = rzpSub.current_end
      ? new Date((rzpSub.current_end as number) * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // fallback 30 days

    // Update subscription to ACTIVE
    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "ACTIVE",
        razorpayCustomerId: rzpSub.customer_id || null,
        paymentMethod: (rzpSub as any).payment_method || null,
        currentPeriodStart: rzpSub.current_start
          ? new Date((rzpSub.current_start as number) * 1000)
          : new Date(),
        currentPeriodEnd: currentEnd,
        endDate: currentEnd,
      },
    });

    // Create invoice record
    await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${Date.now()}`,
        subscriptionId: subscription.id,
        amount:
          PLAN_PRICES[subscription.plan as keyof typeof PLAN_PRICES] / 100,
        status: "PAID",
        razorpayPaymentId: razorpay_payment_id,
        paidAt: new Date(),
        paymentMethod: (rzpSub as any).payment_method || null,
      },
    });

    return c.json({ success: true, subscription: updated });
  } catch (error) {
    console.log("Verify Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/cancel — cancel subscription
protectedRoutes.post("/cancel", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const subscription = await getLatestSubscription(restaurant.id);
    if (!subscription) return c.json({ error: "No subscription" }, 404);

    if (!["ACTIVE", "TRIAL"].includes(subscription.status)) {
      return c.json({ error: "No active subscription to cancel" }, 400);
    }

    // Cancel on Razorpay if it exists
    if (subscription.razorpaySubscriptionId) {
      await getRazorpay().subscriptions.cancel(
        subscription.razorpaySubscriptionId,
        false // cancel at end of billing cycle
      );
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    return c.json({ success: true, subscription: updated });
  } catch (error) {
    console.log("Cancel Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /billing/invoices — list invoices
protectedRoutes.get("/invoices", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const invoices = await prisma.invoice.findMany({
      where: {
        subscription: { restaurantId: restaurant.id, isDeleted: false },
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
    const rzpSub = event.payload?.subscription?.entity;
    const rzpPayment = event.payload?.payment?.entity;

    if (!rzpSub?.id) {
      return c.json({ status: "ignored" });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: rzpSub.id },
    });

    if (!subscription) {
      return c.json({ status: "subscription not found" });
    }

    switch (eventType) {
      case "subscription.activated": {
        const currentEnd = rzpSub.current_end
          ? new Date(rzpSub.current_end * 1000)
          : subscription.endDate;

        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "ACTIVE",
            razorpayCustomerId: rzpSub.customer_id || null,
            paymentMethod: rzpSub.payment_method || null,
            currentPeriodStart: rzpSub.current_start
              ? new Date(rzpSub.current_start * 1000)
              : new Date(),
            currentPeriodEnd: currentEnd,
            endDate: currentEnd,
          },
        });
        break;
      }

      case "subscription.charged": {
        const currentEnd = rzpSub.current_end
          ? new Date(rzpSub.current_end * 1000)
          : subscription.endDate;

        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "ACTIVE",
            currentPeriodStart: rzpSub.current_start
              ? new Date(rzpSub.current_start * 1000)
              : new Date(),
            currentPeriodEnd: currentEnd,
            endDate: currentEnd,
          },
        });

        // Create invoice for this charge
        if (rzpPayment) {
          await prisma.invoice.create({
            data: {
              invoiceNumber: `INV-${Date.now()}`,
              subscriptionId: subscription.id,
              amount: rzpPayment.amount / 100, // paise to rupees
              status: "PAID",
              razorpayPaymentId: rzpPayment.id,
              razorpayInvoiceId: rzpPayment.invoice_id || null,
              razorpayOrderId: rzpPayment.order_id || null,
              paidAt: new Date(rzpPayment.created_at * 1000),
              paymentMethod: rzpPayment.method || null,
            },
          });
        }
        break;
      }

      case "subscription.pending": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "PENDING" },
        });
        break;
      }

      case "subscription.halted": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "HALTED" },
        });
        break;
      }

      case "subscription.cancelled": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        });
        break;
      }

      case "subscription.paused": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "PAUSED" },
        });
        break;
      }

      case "subscription.resumed": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "ACTIVE" },
        });
        break;
      }

      case "subscription.completed": {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "COMPLETED" },
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
  } catch (error) {
    console.log("Webhook Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// ── Mount both ──────────────────────────────────────────────

billingRoutes.route("/", protectedRoutes);
billingRoutes.route("/", webhookRoutes);
