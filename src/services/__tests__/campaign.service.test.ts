import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    customer: { count: vi.fn(), findMany: vi.fn() },
    campaign: { findFirst: vi.fn(), update: vi.fn() },
    campaignDelivery: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((fn: any) => {
      if (typeof fn === "function") {
        return fn({
          campaign: { update: vi.fn() },
          campaignDelivery: { createMany: vi.fn() },
        });
      }
      return Promise.all(fn);
    }),
  },
}));

vi.mock("../../repositories/campaign.repository", () => ({
  campaignRepository: {
    create: vi.fn(),
    findDeletable: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../lib/razorpay", () => ({
  getRazorpay: vi.fn(() => ({
    orders: { create: vi.fn().mockResolvedValue({ id: "rzp_order_1" }) },
  })),
  verifyOrderPaymentSignature: vi.fn(),
}));

import { createDraft, checkout, verifyAndSend, CampaignError } from "../campaign.service";
import { campaignRepository } from "../../repositories/campaign.repository";
import { prisma } from "../../lib/prisma";
import { verifyOrderPaymentSignature } from "../../lib/razorpay";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDraft", () => {
  it("throws when title is missing", async () => {
    await expect(
      createDraft("rest-1", { title: "", message: "hi" })
    ).rejects.toThrow(CampaignError);
  });

  it("throws when message is missing", async () => {
    await expect(
      createDraft("rest-1", { title: "Sale", message: "" })
    ).rejects.toThrow(CampaignError);
  });

  it("throws when no customers exist", async () => {
    vi.mocked(prisma.customer.count).mockResolvedValue(0);
    await expect(
      createDraft("rest-1", { title: "Sale", message: "50% off" })
    ).rejects.toThrow("No customers to target");
  });

  it("creates draft with correct cost calculation", async () => {
    vi.mocked(prisma.customer.count).mockResolvedValue(100);
    vi.mocked(campaignRepository.create).mockImplementation(async (data: any) => data);

    await createDraft("rest-1", { title: "Sale", message: "50% off", imageUrl: "img.jpg" });

    expect(campaignRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "rest-1",
        title: "Sale",
        message: "50% off",
        imageUrl: "img.jpg",
        audienceCount: 100,
        costPerMessage: 1.38,
        totalCost: 138,
        status: "DRAFT",
        type: "CUSTOM",
      })
    );
  });

  it("uses provided type instead of CUSTOM", async () => {
    vi.mocked(prisma.customer.count).mockResolvedValue(10);
    vi.mocked(campaignRepository.create).mockImplementation(async (data: any) => data);

    await createDraft("rest-1", { type: "DISCOUNT", title: "Sale", message: "off" });
    expect(campaignRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DISCOUNT" })
    );
  });
});

describe("checkout", () => {
  it("throws when campaign not found", async () => {
    vi.mocked(campaignRepository.findDeletable).mockResolvedValue(null);
    await expect(checkout("camp-1", "rest-1", "a@b.com")).rejects.toThrow(
      "Campaign not found or already paid"
    );
  });

  it("creates razorpay order and returns checkout data", async () => {
    vi.mocked(campaignRepository.findDeletable).mockResolvedValue({
      id: "camp-1",
      totalCost: 138,
    } as never);
    vi.mocked(campaignRepository.update).mockResolvedValue({} as never);

    const result = await checkout("camp-1", "rest-1", "a@b.com");

    expect(result).toEqual(
      expect.objectContaining({
        razorpayOrderId: "rzp_order_1",
        amount: 13800,
        currency: "INR",
        email: "a@b.com",
      })
    );
    expect(campaignRepository.update).toHaveBeenCalledWith("camp-1", {
      razorpayOrderId: "rzp_order_1",
      status: "PAYING",
    });
  });

  it("enforces minimum amount of 100 paise", async () => {
    vi.mocked(campaignRepository.findDeletable).mockResolvedValue({
      id: "camp-1",
      totalCost: 0.5, // 50 paise
    } as never);
    vi.mocked(campaignRepository.update).mockResolvedValue({} as never);

    const result = await checkout("camp-1", "rest-1", "a@b.com");
    expect(result.amount).toBe(100); // minimum ₹1
  });
});

describe("verifyAndSend", () => {
  it("throws on missing payment details", async () => {
    await expect(
      verifyAndSend("camp-1", "rest-1", {
        razorpay_payment_id: "",
        razorpay_order_id: "ord",
        razorpay_signature: "sig",
      })
    ).rejects.toThrow("Missing payment details");
  });

  it("throws on invalid signature", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(false);
    await expect(
      verifyAndSend("camp-1", "rest-1", {
        razorpay_payment_id: "pay",
        razorpay_order_id: "ord",
        razorpay_signature: "bad",
      })
    ).rejects.toThrow("Invalid payment signature");
  });

  it("throws when campaign not found", async () => {
    vi.mocked(verifyOrderPaymentSignature).mockReturnValue(true);
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue(null);

    await expect(
      verifyAndSend("camp-1", "rest-1", {
        razorpay_payment_id: "pay",
        razorpay_order_id: "ord",
        razorpay_signature: "valid",
      })
    ).rejects.toThrow("Campaign not found");
  });
});
