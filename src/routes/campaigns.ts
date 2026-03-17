import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { getRazorpay, verifyOrderPaymentSignature } from "../lib/razorpay";
import type { Env } from "../types";

export const campaignRoutes = new Hono<Env>();

campaignRoutes.use("*", ownerAuth);

const COST_PER_MESSAGE = 0.5; // ₹0.50 per customer

// GET /campaigns — list campaigns
campaignRoutes.get("/", async (c) => {
  try {
    const userId = c.get("userId");
    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));

    const where = { restaurantId: restaurant.id };

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          _count: { select: { deliveries: true } },
          deliveries: {
            select: { status: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.campaign.count({ where }),
    ]);

    // Compute delivery stats per campaign
    const result = campaigns.map((c) => {
      const sent = c.deliveries.filter((d) => d.status === "SENT").length;
      const delivered = c.deliveries.filter((d) => d.status === "DELIVERED").length;
      const failed = c.deliveries.filter((d) => d.status === "FAILED").length;
      const pending = c.deliveries.filter((d) => d.status === "PENDING").length;
      const { deliveries: _, _count, ...campaign } = c;
      return { ...campaign, stats: { sent, delivered, failed, pending, total: _count.deliveries } };
    });

    // Aggregate stats
    const allCampaigns = await prisma.campaign.findMany({
      where: { restaurantId: restaurant.id },
      select: { audienceCount: true, totalCost: true, status: true },
    });

    const stats = {
      totalCampaigns: allCampaigns.length,
      totalReach: allCampaigns.reduce((s, c) => s + c.audienceCount, 0),
      totalSpent: allCampaigns.filter((c) => c.status !== "DRAFT" && c.status !== "FAILED").reduce((s, c) => s + c.totalCost, 0),
    };

    return c.json({
      campaigns: result,
      stats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[GET /campaigns] error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /campaigns/:id — campaign detail
campaignRoutes.get("/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const campaign = await prisma.campaign.findFirst({
      where: { id, restaurantId: restaurant.id },
      include: {
        deliveries: {
          select: { status: true, channel: true, sentAt: true, deliveredAt: true },
        },
      },
    });

    if (!campaign) return c.json({ error: "Campaign not found" }, 404);

    const stats = {
      sent: campaign.deliveries.filter((d) => d.status === "SENT").length,
      delivered: campaign.deliveries.filter((d) => d.status === "DELIVERED").length,
      failed: campaign.deliveries.filter((d) => d.status === "FAILED").length,
      pending: campaign.deliveries.filter((d) => d.status === "PENDING").length,
      whatsapp: campaign.deliveries.filter((d) => d.channel === "WHATSAPP").length,
      sms: campaign.deliveries.filter((d) => d.channel === "SMS").length,
      total: campaign.deliveries.length,
    };

    const { deliveries: _, ...campaignData } = campaign;
    return c.json({ ...campaignData, stats });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /campaigns — create draft campaign
campaignRoutes.post("/", async (c) => {
  try {
    const userId = c.get("userId");
    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const { type, title, message, imageUrl, scheduledAt } = await c.req.json();

    if (!title?.trim() || !message?.trim()) {
      return c.json({ error: "Title and message are required" }, 400);
    }

    // Count customers for this restaurant
    const audienceCount = await prisma.customer.count({
      where: { restaurantId: restaurant.id },
    });

    if (audienceCount === 0) {
      return c.json({ error: "No customers to target" }, 400);
    }

    const totalCost = Math.round(audienceCount * COST_PER_MESSAGE * 100) / 100;

    const campaign = await prisma.campaign.create({
      data: {
        restaurantId: restaurant.id,
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
    console.error("[POST /campaigns] error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /campaigns/:id/checkout — create Razorpay order for campaign payment
campaignRoutes.post("/:id/checkout", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const campaign = await prisma.campaign.findFirst({
      where: { id, restaurantId: restaurant.id, status: "DRAFT" },
    });
    if (!campaign) return c.json({ error: "Campaign not found or already paid" }, 404);

    const amountInPaise = Math.round(campaign.totalCost * 100);

    const rzpOrder = await getRazorpay().orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `camp_${campaign.id.slice(-8)}`,
      notes: {
        campaign_id: campaign.id,
        restaurant_id: restaurant.id,
      },
    });

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { razorpayOrderId: rzpOrder.id, status: "PAYING" },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });

    return c.json({
      razorpayOrderId: rzpOrder.id,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise,
      currency: "INR",
      name: user?.name || "",
      email: user?.email || "",
    });
  } catch (error) {
    console.error("[POST /campaigns/:id/checkout] error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /campaigns/:id/verify — verify payment and trigger sending
campaignRoutes.post("/:id/verify", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = await c.req.json();

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return c.json({ error: "Missing payment details" }, 400);
    }

    const isValid = verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return c.json({ error: "Invalid payment signature" }, 400);
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const campaign = await prisma.campaign.findFirst({
      where: { id, restaurantId: restaurant.id, razorpayOrderId: razorpay_order_id },
    });
    if (!campaign) return c.json({ error: "Campaign not found" }, 404);

    // Get all customers
    const customers = await prisma.customer.findMany({
      where: { restaurantId: restaurant.id },
      select: { id: true },
    });

    // Create delivery records and update campaign in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          razorpayPaymentId: razorpay_payment_id,
          status: campaign.scheduledAt && new Date(campaign.scheduledAt) > new Date() ? "SCHEDULED" : "SENDING",
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

    return c.json({ success: true, message: "Payment verified. Campaign is being sent." });
  } catch (error) {
    console.error("[POST /campaigns/:id/verify] error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// Simulated message delivery (Phase 1)
async function simulateDelivery(campaignId: string) {
  // Small delay to simulate async sending
  setTimeout(async () => {
    try {
      const deliveries = await prisma.campaignDelivery.findMany({
        where: { campaignId, status: "PENDING" },
      });

      for (const delivery of deliveries) {
        // Simulate: 85% WhatsApp success, 15% fallback to SMS
        const whatsappSuccess = Math.random() > 0.15;

        if (whatsappSuccess) {
          await prisma.campaignDelivery.update({
            where: { id: delivery.id },
            data: { status: "DELIVERED", channel: "WHATSAPP", sentAt: new Date(), deliveredAt: new Date() },
          });
        } else {
          // SMS fallback — 95% success
          const smsSuccess = Math.random() > 0.05;
          await prisma.campaignDelivery.update({
            where: { id: delivery.id },
            data: {
              status: smsSuccess ? "DELIVERED" : "FAILED",
              channel: "SMS",
              sentAt: new Date(),
              deliveredAt: smsSuccess ? new Date() : null,
              failReason: smsSuccess ? "" : "SMS delivery failed",
            },
          });
        }
      }

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    } catch (error) {
      console.error("[simulateDelivery] error:", error);
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "FAILED" },
      });
    }
  }, 2000);
}
