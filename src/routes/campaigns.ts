import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { getRazorpay, verifyOrderPaymentSignature } from "../lib/razorpay";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const campaignRoutes = new Hono<Env>();

campaignRoutes.use("*", ownerAuth);

const COST_PER_MESSAGE = 1.38; // ₹1.38 per customer (36% margin over ₹0.88 delivery cost)

function debugMsg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) return JSON.stringify(error);
  return String(error);
}

// GET /campaigns — list campaigns
campaignRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(c.req.query("limit") || "20", 10)),
    );

    const where = { restaurantId };

    const [campaigns, total, aggStats] = await Promise.all([
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campaign.count({ where }),
      prisma.campaign.aggregate({
        where: { restaurantId },
        _sum: { audienceCount: true, totalCost: true },
        _count: true,
      }),
    ]);

    // Get delivery counts grouped by status for these campaigns (single query)
    const campaignIds = campaigns.map((c) => c.id);
    const deliveryCounts =
      campaignIds.length > 0
        ? await prisma.campaignDelivery.groupBy({
            by: ["campaignId", "status"],
            where: { campaignId: { in: campaignIds } },
            _count: true,
          })
        : [];

    // Build stats map per campaign
    const statsMap = new Map<
      string,
      {
        sent: number;
        delivered: number;
        failed: number;
        pending: number;
        total: number;
      }
    >();
    for (const row of deliveryCounts) {
      const existing = statsMap.get(row.campaignId) || {
        sent: 0,
        delivered: 0,
        failed: 0,
        pending: 0,
        total: 0,
      };
      existing.total += row._count;
      if (row.status === "SENT") existing.sent = row._count;
      else if (row.status === "DELIVERED") existing.delivered = row._count;
      else if (row.status === "FAILED") existing.failed = row._count;
      else if (row.status === "PENDING") existing.pending = row._count;
      statsMap.set(row.campaignId, existing);
    }

    const result = campaigns.map((c) => ({
      ...c,
      stats: statsMap.get(c.id) || {
        sent: 0,
        delivered: 0,
        failed: 0,
        pending: 0,
        total: 0,
      },
    }));

    const stats = {
      totalCampaigns: aggStats._count,
      totalReach: aggStats._sum.audienceCount || 0,
      totalSpent: aggStats._sum.totalCost || 0,
    };

    return c.json({
      campaigns: result,
      stats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return c.json({ error: "Server error", debug: debugMsg(error) }, 500);
  }
});

// GET /campaigns/:id — campaign detail
campaignRoutes.get("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const [campaign, statusCounts, channelCounts] = await Promise.all([
      prisma.campaign.findFirst({
        where: { id, restaurantId },
      }),
      prisma.campaignDelivery.groupBy({
        by: ["status"],
        where: { campaignId: id },
        _count: true,
      }),
      prisma.campaignDelivery.groupBy({
        by: ["channel"],
        where: { campaignId: id },
        _count: true,
      }),
    ]);

    if (!campaign) return c.json({ error: "Campaign not found" }, 404);

    const stats = { sent: 0, delivered: 0, failed: 0, pending: 0, whatsapp: 0, sms: 0, total: 0 };
    for (const row of statusCounts) {
      stats.total += row._count;
      if (row.status === "SENT") stats.sent = row._count;
      else if (row.status === "DELIVERED") stats.delivered = row._count;
      else if (row.status === "FAILED") stats.failed = row._count;
      else if (row.status === "PENDING") stats.pending = row._count;
    }
    for (const row of channelCounts) {
      if (row.channel === "WHATSAPP") stats.whatsapp = row._count;
      else if (row.channel === "SMS") stats.sms = row._count;
    }

    return c.json({ ...campaign, stats });
  } catch (error) {
    return c.json({ error: "Server error", debug: debugMsg(error) }, 500);
  }
});

// POST /campaigns — create draft campaign
campaignRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const { type, title, message, imageUrl, scheduledAt } = await c.req.json();

    if (!title?.trim() || !message?.trim()) {
      return c.json({ error: "Title and message are required" }, 400);
    }

    // Count customers for this restaurant
    const audienceCount = await prisma.customer.count({
      where: { restaurantId },
    });

    if (audienceCount === 0) {
      return c.json({ error: "No customers to target" }, 400);
    }

    const totalCost = Math.round(audienceCount * COST_PER_MESSAGE * 100) / 100;

    const campaign = await prisma.campaign.create({
      data: {
        restaurantId,
        type: type || "CUSTOM",
        title: title.trim(),
        message: message.trim(),
        imageUrl: imageUrl || "",
        audienceCount,
        costPerMessage: COST_PER_MESSAGE,
        totalCost,
        status: "DRAFT",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
    });

    return c.json(campaign, 201);
  } catch (error) {
    return c.json({ error: "Server error", debug: debugMsg(error) }, 500);
  }
});

// DELETE /campaigns/:id — delete a draft campaign
campaignRoutes.delete("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const campaign = await prisma.campaign.findFirst({
      where: { id, restaurantId, status: { in: ["DRAFT", "PAYING"] } },
    });
    if (!campaign)
      return c.json({ error: "Campaign not found or cannot be deleted" }, 404);

    await prisma.campaign.delete({ where: { id: campaign.id } });

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Server error", debug: debugMsg(error) }, 500);
  }
});

// POST /campaigns/:id/checkout — create Razorpay order for campaign payment
campaignRoutes.post("/:id/checkout", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const campaign = await prisma.campaign.findFirst({
      where: { id, restaurantId, status: { in: ["DRAFT", "PAYING"] } },
    });
    if (!campaign)
      return c.json({ error: "Campaign not found or already paid" }, 404);

    // Razorpay minimum order is ₹1 (100 paise)
    const amountInPaise = Math.max(100, Math.round(campaign.totalCost * 100));
    const rzpOrder = await getRazorpay().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `camp_${campaign.id.slice(-8)}`,
      notes: {
        campaign_id: campaign.id,
        restaurant_id: restaurantId,
      },
    });

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { razorpayOrderId: rzpOrder.id, status: "PAYING" },
    });

    return c.json({
      razorpayOrderId: rzpOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: "INR",
      name: "",
      email: c.get(CTX.EMAIL),
    });
  } catch (error) {
    return c.json({ error: "Server error", debug: debugMsg(error) }, 500);
  }
});

// POST /campaigns/:id/verify — verify payment and trigger sending
campaignRoutes.post("/:id/verify", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
    const id = c.req.param("id");

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
      await c.req.json();

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return c.json({ error: "Missing payment details" }, 400);
    }

    const isValid = verifyOrderPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );
    if (!isValid) {
      return c.json({ error: "Invalid payment signature" }, 400);
    }

    const campaign = await prisma.campaign.findFirst({
      where: { id, restaurantId, razorpayOrderId: razorpay_order_id },
    });
    if (!campaign) return c.json({ error: "Campaign not found" }, 404);

    // Get all customers
    const customers = await prisma.customer.findMany({
      where: { restaurantId },
      select: { id: true },
    });

    // Create delivery records and update campaign in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          razorpayPaymentId: razorpay_payment_id,
          status:
            campaign.scheduledAt && new Date(campaign.scheduledAt) > new Date()
              ? "SCHEDULED"
              : "SENDING",
          sentAt: campaign.scheduledAt ? null : new Date(),
        },
      });

      await tx.campaignDelivery.createMany({
        data: customers.map((cust) => ({
          campaignId: campaign.id,
          customerId: cust.id,
          channel: "WHATSAPP" as const,
          status: "PENDING" as const,
        })),
      });
    });

    // Simulate delivery (Phase 1 — replace with real WhatsApp/SMS later)
    simulateDelivery(campaign.id);

    return c.json({
      success: true,
      message: "Payment verified. Campaign is being sent.",
    });
  } catch (error) {
    return c.json({ error: "Server error", debug: debugMsg(error) }, 500);
  }
});

// Simulated message delivery (Phase 1)
async function simulateDelivery(campaignId: string) {
  setTimeout(async () => {
    try {
      const deliveries = await prisma.campaignDelivery.findMany({
        where: { campaignId, status: "PENDING" },
        select: { id: true },
      });

      // Split into WhatsApp success (85%) and SMS fallback (15%)
      const whatsappIds: string[] = [];
      const smsSuccessIds: string[] = [];
      const smsFailIds: string[] = [];

      for (const d of deliveries) {
        if (Math.random() > 0.15) {
          whatsappIds.push(d.id);
        } else if (Math.random() > 0.05) {
          smsSuccessIds.push(d.id);
        } else {
          smsFailIds.push(d.id);
        }
      }

      const now = new Date();

      // 3 batch updates instead of N individual updates
      await prisma.$transaction([
        ...(whatsappIds.length > 0 ? [prisma.campaignDelivery.updateMany({
          where: { id: { in: whatsappIds } },
          data: { status: "DELIVERED", channel: "WHATSAPP", sentAt: now, deliveredAt: now },
        })] : []),
        ...(smsSuccessIds.length > 0 ? [prisma.campaignDelivery.updateMany({
          where: { id: { in: smsSuccessIds } },
          data: { status: "DELIVERED", channel: "SMS", sentAt: now, deliveredAt: now },
        })] : []),
        ...(smsFailIds.length > 0 ? [prisma.campaignDelivery.updateMany({
          where: { id: { in: smsFailIds } },
          data: { status: "FAILED", channel: "SMS", sentAt: now, failReason: "SMS delivery failed" },
        })] : []),
        prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "COMPLETED", completedAt: now },
        }),
      ]);
    } catch {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "FAILED" },
      });
    }
  }, 2000);
}
