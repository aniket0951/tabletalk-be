import { subscriptionRepository } from "../repositories/subscription.repository";
import { invoiceRepository } from "../repositories/invoice.repository";
import {
  getRazorpay,
  PLAN_PRICES,
  verifyOrderPaymentSignature,
  verifyWebhookSignature,
} from "../lib/razorpay";
import { SUBSCRIPTION_STATUS, INVOICE_STATUS, VALID_PLANS } from "../lib/constants";
import { prisma } from "../lib/prisma";

export class BillingError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function createTrialSubscription(restaurantId: string, plan: string) {
  if (!VALID_PLANS.includes(plan as never)) {
    throw new BillingError("Invalid plan", 400);
  }

  const existing = await subscriptionRepository.findLatest(restaurantId);
  if (existing && ([SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE] as string[]).includes(existing.status)) {
    throw new BillingError("Active subscription already exists", 400);
  }

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 14);

  return subscriptionRepository.create({
    plan: plan as never,
    status: SUBSCRIPTION_STATUS.TRIAL,
    startDate: new Date(),
    endDate,
    restaurantId,
  });
}

export async function createCheckout(restaurantId: string, userId: string, plan: string) {
  if (!VALID_PLANS.includes(plan as never)) {
    throw new BillingError("Invalid plan", 400);
  }

  // Block checkout if already has active/trial subscription
  const existing = await subscriptionRepository.findLatest(restaurantId);
  if (existing && ([SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE] as string[]).includes(existing.status)) {
    // Check if active subscription is actually expired (auto-expire)
    if (new Date() <= existing.endDate) {
      throw new BillingError("Active subscription already exists. Cancel first or wait for it to expire.", 400);
    }
    // Expired — allow renewal
    await subscriptionRepository.update(existing.id, { status: SUBSCRIPTION_STATUS.EXPIRED });
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: { user: true },
  });
  if (!restaurant) throw new BillingError("No restaurant", 404);

  const amount = PLAN_PRICES[plan as keyof typeof PLAN_PRICES];

  const rzpOrder = await getRazorpay().orders.create({
    amount,
    currency: "INR",
    receipt: `rcpt_${Date.now()}`,
    notes: { restaurant_id: restaurantId, user_id: userId, plan },
  });

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const subscription = await subscriptionRepository.create({
    plan: plan as never,
    status: SUBSCRIPTION_STATUS.PENDING,
    startDate: new Date(),
    endDate,
    restaurantId,
    razorpaySubscriptionId: rzpOrder.id,
  });

  return {
    subscriptionId: subscription.id,
    razorpayOrderId: rzpOrder.id,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    amount,
    currency: "INR",
    name: restaurant.name,
    email: restaurant.user.email,
  };
}

export async function verifyPayment(paymentDetails: {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}) {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = paymentDetails;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    throw new BillingError("Missing payment details", 400);
  }

  const isValid = verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    throw new BillingError("Invalid payment signature", 400);
  }

  const subscription = await subscriptionRepository.findByRazorpayOrderId(razorpay_order_id);
  if (!subscription) {
    throw new BillingError("Subscription not found", 404);
  }

  // Idempotency: if already activated, return existing subscription
  if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
    return subscription;
  }

  const rzpPayment = await getRazorpay().payments.fetch(razorpay_payment_id);

  const now = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const updated = await subscriptionRepository.update(subscription.id, {
    status: SUBSCRIPTION_STATUS.ACTIVE,
    paymentMethod: rzpPayment.method || null,
    currentPeriodStart: now,
    currentPeriodEnd: endDate,
    endDate,
  });

  // Idempotency: use try-catch for unique constraint on razorpayPaymentId
  try {
    await invoiceRepository.create({
      invoiceNumber: `INV-${Date.now()}`,
      subscriptionId: subscription.id,
      amount: PLAN_PRICES[subscription.plan as keyof typeof PLAN_PRICES] / 100,
      status: INVOICE_STATUS.PAID,
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      paidAt: new Date(),
      paymentMethod: rzpPayment.method || null,
    });
  } catch {
    // Invoice already exists for this payment (duplicate verify call) — safe to ignore
  }

  return updated;
}

export async function cancelSubscription(restaurantId: string) {
  const subscription = await subscriptionRepository.findLatest(restaurantId);
  if (!subscription) {
    throw new BillingError("No subscription", 404);
  }

  if (!([SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIAL] as string[]).includes(subscription.status)) {
    throw new BillingError("No active subscription to cancel", 400);
  }

  return subscriptionRepository.update(subscription.id, {
    status: SUBSCRIPTION_STATUS.CANCELLED,
    cancelledAt: new Date(),
  });
}

export async function handleWebhook(rawBody: string, signature: string | undefined) {
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    throw new BillingError("Invalid signature", 400);
  }

  const event = JSON.parse(rawBody);

  // Log webhook with payment_id for deduplication
  const rzpPayment = event.payload?.payment?.entity;
  const paymentId = rzpPayment?.id || null;

  await prisma.razorpayWebhookLog.create({
    data: {
      eventType: event.event,
      payload: rawBody,
      processed: false,
    },
  });

  const eventType: string = event.event;

  if (!rzpPayment?.order_id) {
    return { status: "ignored" };
  }

  const subscription = await subscriptionRepository.findByRazorpayOrderId(rzpPayment.order_id);
  if (!subscription) {
    return { status: "subscription not found" };
  }

  switch (eventType) {
    case "payment.captured": {
      // Idempotency: skip if already activated by verify endpoint
      if (subscription.status === SUBSCRIPTION_STATUS.ACTIVE) {
        break;
      }

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);
      await subscriptionRepository.update(subscription.id, {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        paymentMethod: rzpPayment.method || null,
        currentPeriodStart: new Date(),
        currentPeriodEnd: endDate,
        endDate,
      });
      break;
    }
    case "payment.failed": {
      // Only halt if still PENDING — don't overwrite ACTIVE
      if (subscription.status === SUBSCRIPTION_STATUS.PENDING) {
        await subscriptionRepository.update(subscription.id, {
          status: SUBSCRIPTION_STATUS.HALTED,
        });
      }
      break;
    }
  }

  // Mark only THIS webhook as processed (by matching payload content)
  if (paymentId) {
    await prisma.razorpayWebhookLog.updateMany({
      where: {
        eventType,
        processed: false,
        payload: { contains: paymentId },
      },
      data: { processed: true },
    });
  }

  return { status: "ok" };
}

export const billingService = {
  createTrialSubscription,
  createCheckout,
  verifyPayment,
  cancelSubscription,
  handleWebhook,
};
