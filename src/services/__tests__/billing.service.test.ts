import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    restaurant: { findUnique: vi.fn() },
    razorpayWebhookLog: { create: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("../../repositories/subscription.repository", () => ({
  subscriptionRepository: {
    findLatest: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findByRazorpayOrderId: vi.fn(),
  },
}));

vi.mock("../../repositories/invoice.repository", () => ({
  invoiceRepository: {
    create: vi.fn(),
  },
}));

vi.mock("../../lib/razorpay", () => ({
  getRazorpay: vi.fn(() => ({
    orders: { create: vi.fn() },
    payments: { fetch: vi.fn() },
  })),
  PLAN_PRICES: { STARTER: 99900, GROWTH: 149900, MULTI: 399900 },
  verifyOrderPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));

import {
  createTrialSubscription,
  createCheckout,
  verifyPayment,
  cancelSubscription,
  handleWebhook,
  BillingError,
} from "../billing.service";
import { subscriptionRepository } from "../../repositories/subscription.repository";
import { invoiceRepository } from "../../repositories/invoice.repository";
import { getRazorpay, verifyOrderPaymentSignature, verifyWebhookSignature } from "../../lib/razorpay";
import { prisma } from "../../lib/prisma";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTrialSubscription", () => {
  it("throws on invalid plan", async () => {
    await expect(createTrialSubscription("rest-1", "INVALID")).rejects.toThrow(BillingError);
    await expect(createTrialSubscription("rest-1", "INVALID")).rejects.toThrow("Invalid plan");
  });

  it("throws when active subscription exists", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue({
      status: "TRIAL",
    } as never);

    await expect(createTrialSubscription("rest-1", "STARTER")).rejects.toThrow("Active subscription already exists");
  });

  it("creates trial with 14-day duration", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue(null);
    vi.mocked(subscriptionRepository.create).mockImplementation(async (data: any) => data);

    const result = await createTrialSubscription("rest-1", "STARTER");

    expect(subscriptionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "STARTER",
        status: "TRIAL",
        restaurantId: "rest-1",
      })
    );
    // Verify endDate is ~14 days from now
    const createArg = vi.mocked(subscriptionRepository.create).mock.calls[0][0] as any;
    const diffDays = Math.round((createArg.endDate.getTime() - createArg.startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(14);
  });

  it("allows trial when previous subscription is expired", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue({
      status: "EXPIRED",
    } as never);
    vi.mocked(subscriptionRepository.create).mockImplementation(async (data: any) => data);

    await expect(createTrialSubscription("rest-1", "STARTER")).resolves.toBeDefined();
  });
});

describe("cancelSubscription", () => {
  it("throws when no subscription exists", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue(null);
    await expect(cancelSubscription("rest-1")).rejects.toThrow("No subscription");
  });

  it("throws when subscription is not active", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue({
      status: "EXPIRED",
    } as never);
    await expect(cancelSubscription("rest-1")).rejects.toThrow("No active subscription to cancel");
  });

  it("cancels active subscription", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
    } as never);
    vi.mocked(subscriptionRepository.update).mockResolvedValue({} as never);

    await cancelSubscription("rest-1");

    expect(subscriptionRepository.update).toHaveBeenCalledWith("sub-1", {
      status: "CANCELLED",
      cancelledAt: expect.any(Date),
    });
  });

  it("cancels trial subscription", async () => {
    vi.mocked(subscriptionRepository.findLatest).mockResolvedValue({
      id: "sub-1",
      status: "TRIAL",
    } as never);
    vi.mocked(subscriptionRepository.update).mockResolvedValue({} as never);

    await cancelSubscription("rest-1");
    expect(subscriptionRepository.update).toHaveBeenCalled();
  });
});

describe("createCheckout", () => {
  it("throws on invalid plan", async () => {
    await expect(createCheckout("rest-1", "usr-1", "INVALID")).rejects.toThrow("Invalid plan");
  });

  it("throws when restaurant not found", async () => {
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue(null);
    await expect(createCheckout("rest-1", "usr-1", "STARTER")).rejects.toThrow("No restaurant");
  });

  it("creates razorpay order and pending subscription", async () => {
    vi.mocked(prisma.restaurant.findUnique).mockResolvedValue({
      id: "rest-1",
      name: "Test Restaurant",
      user: { email: "a@b.com" },
    } as never);
    const mockRzp = { orders: { create: vi.fn().mockResolvedValue({ id: "rzp_order_1" }) } };
    vi.mocked(getRazorpay).mockReturnValue(mockRzp as never);
    vi.mocked(subscriptionRepository.create).mockResolvedValue({ id: "sub-1" } as never);

    const result = await createCheckout("rest-1", "usr-1", "STARTER");

    expect(result.razorpayOrderId).toBe("rzp_order_1");
    expect(result.amount).toBe(99900);
    expect(result.name).toBe("Test Restaurant");
    expect(result.email).toBe("a@b.com");
    expect(subscriptionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "STARTER", status: "PENDING" })
    );
  });
});

describe("verifyPayment", () => {
  it("throws on missing payment details", async () => {
    await expect(
      verifyPayment({ razorpay_payment_id: "", razorpay_order_id: "ord", razorpay_signature: "sig" })
    ).rejects.toThrow("Missing payment details");
  });

  it("throws on missing order_id", async () => {
    await expect(
      verifyPayment({ razorpay_payment_id: "pay", razorpay_order_id: "", razorpay_signature: "sig" })
    ).rejects.toThrow("Missing payment details");
  });

  it("throws on invalid signature", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(false);

    await expect(
      verifyPayment({ razorpay_payment_id: "pay_1", razorpay_order_id: "ord_1", razorpay_signature: "bad" })
    ).rejects.toThrow("Invalid payment signature");
  });

  it("throws when subscription not found", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(true);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue(null);

    await expect(
      verifyPayment({ razorpay_payment_id: "pay_1", razorpay_order_id: "ord_1", razorpay_signature: "valid" })
    ).rejects.toThrow("Subscription not found");
  });

  it("activates subscription and creates invoice on valid payment", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(true);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      plan: "STARTER",
      status: "PENDING",
    } as never);
    const mockRzp = { payments: { fetch: vi.fn().mockResolvedValue({ method: "upi" }) } };
    vi.mocked(getRazorpay).mockReturnValue(mockRzp as never);
    vi.mocked(subscriptionRepository.update).mockResolvedValue({ id: "sub-1", status: "ACTIVE" } as never);
    vi.mocked(invoiceRepository.create).mockResolvedValue({} as never);

    const result = await verifyPayment({
      razorpay_payment_id: "pay_1",
      razorpay_order_id: "ord_1",
      razorpay_signature: "valid",
    });

    expect(subscriptionRepository.update).toHaveBeenCalledWith("sub-1", expect.objectContaining({
      status: "ACTIVE",
      paymentMethod: "upi",
    }));
    expect(invoiceRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "sub-1",
      amount: 999,
      status: "PAID",
      razorpayPaymentId: "pay_1",
    }));
    expect(result).toEqual(expect.objectContaining({ status: "ACTIVE" }));
  });

  it("returns existing subscription if already active (idempotent)", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(true);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      plan: "STARTER",
      status: "ACTIVE",
    } as never);

    const result = await verifyPayment({
      razorpay_payment_id: "pay_1",
      razorpay_order_id: "ord_1",
      razorpay_signature: "valid",
    });

    expect(result).toEqual(expect.objectContaining({ id: "sub-1", status: "ACTIVE" }));
    expect(subscriptionRepository.update).not.toHaveBeenCalled();
    expect(invoiceRepository.create).not.toHaveBeenCalled();
  });

  it("handles duplicate invoice gracefully", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(true);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      plan: "STARTER",
      status: "PENDING",
    } as never);
    const mockRzp = { payments: { fetch: vi.fn().mockResolvedValue({ method: "card" }) } };
    vi.mocked(getRazorpay).mockReturnValue(mockRzp as never);
    vi.mocked(subscriptionRepository.update).mockResolvedValue({ id: "sub-1", status: "ACTIVE" } as never);
    vi.mocked(invoiceRepository.create).mockRejectedValue(new Error("Unique constraint failed"));

    const result = await verifyPayment({
      razorpay_payment_id: "pay_1",
      razorpay_order_id: "ord_1",
      razorpay_signature: "valid",
    });

    // Should still succeed — invoice already exists
    expect(result).toEqual(expect.objectContaining({ status: "ACTIVE" }));
  });
});

describe("handleWebhook", () => {
  it("throws on invalid signature", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(false);
    await expect(handleWebhook("{}", "bad-sig")).rejects.toThrow("Invalid signature");
  });

  it("throws when no signature provided", async () => {
    await expect(handleWebhook("{}", undefined)).rejects.toThrow("Invalid signature");
  });

  it("returns ignored when no order_id in payment", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(prisma.razorpayWebhookLog.create).mockResolvedValue({} as never);

    const event = { event: "payment.captured", payload: { payment: { entity: {} } } };
    const result = await handleWebhook(JSON.stringify(event), "valid-sig");
    expect(result).toEqual({ status: "ignored" });
  });

  it("activates subscription on payment.captured", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(prisma.razorpayWebhookLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.razorpayWebhookLog.updateMany).mockResolvedValue({} as never);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      status: "PENDING",
    } as never);
    vi.mocked(subscriptionRepository.update).mockResolvedValue({} as never);

    const event = {
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "ord_1", method: "card" } } },
    };
    const result = await handleWebhook(JSON.stringify(event), "valid-sig");

    expect(subscriptionRepository.update).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ status: "ACTIVE", paymentMethod: "card" })
    );
    expect(result).toEqual({ status: "ok" });
  });

  it("skips activation if already ACTIVE (idempotent)", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(prisma.razorpayWebhookLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.razorpayWebhookLog.updateMany).mockResolvedValue({} as never);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
    } as never);

    const event = {
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "ord_1", method: "card" } } },
    };
    const result = await handleWebhook(JSON.stringify(event), "valid-sig");

    expect(subscriptionRepository.update).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok" });
  });

  it("halts subscription on payment.failed when PENDING", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(prisma.razorpayWebhookLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.razorpayWebhookLog.updateMany).mockResolvedValue({} as never);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      status: "PENDING",
    } as never);
    vi.mocked(subscriptionRepository.update).mockResolvedValue({} as never);

    const event = {
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_1", order_id: "ord_1" } } },
    };
    await handleWebhook(JSON.stringify(event), "valid-sig");

    expect(subscriptionRepository.update).toHaveBeenCalledWith("sub-1", { status: "HALTED" });
  });

  it("does not halt ACTIVE subscription on payment.failed", async () => {
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(prisma.razorpayWebhookLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.razorpayWebhookLog.updateMany).mockResolvedValue({} as never);
    vi.mocked(subscriptionRepository.findByRazorpayOrderId).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
    } as never);

    const event = {
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_1", order_id: "ord_1" } } },
    };
    await handleWebhook(JSON.stringify(event), "valid-sig");

    expect(subscriptionRepository.update).not.toHaveBeenCalled();
  });
});
