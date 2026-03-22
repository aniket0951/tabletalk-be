import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX, DELIVERY_STATUS, CHANNEL, CAMPAIGN_STATUS } from "../lib/constants";
import { campaignRepository } from "../repositories/campaign.repository";
import { campaignService, CampaignError } from "../services/campaign.service";
import type { Env } from "../types";
import { success, validationError, serverError } from "../lib/response";

export const campaignRoutes = new Hono<Env>();

campaignRoutes.use("*", ownerAuth, requireRestaurant);

// GET /campaigns — list campaigns
campaignRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));

    const [campaigns, total, aggStats] = await campaignRepository.findMany(restaurantId, page, limit);

    const campaignIds = campaigns.map((c) => c.id);
    const deliveryCounts = await campaignRepository.getDeliveryCounts(campaignIds);

    const statsMap = new Map<string, { sent: number; delivered: number; failed: number; pending: number; total: number }>();
    for (const row of deliveryCounts) {
      const existing = statsMap.get(row.campaignId) || { sent: 0, delivered: 0, failed: 0, pending: 0, total: 0 };
      existing.total += row._count;
      if (row.status === DELIVERY_STATUS.SENT) existing.sent = row._count;
      else if (row.status === DELIVERY_STATUS.DELIVERED) existing.delivered = row._count;
      else if (row.status === DELIVERY_STATUS.FAILED) existing.failed = row._count;
      else if (row.status === DELIVERY_STATUS.PENDING) existing.pending = row._count;
      statsMap.set(row.campaignId, existing);
    }

    const result = campaigns.map((c) => ({
      ...c,
      stats: statsMap.get(c.id) || { sent: 0, delivered: 0, failed: 0, pending: 0, total: 0 },
    }));

    const stats = {
      totalCampaigns: aggStats._count,
      totalReach: aggStats._sum.audienceCount || 0,
      totalSpent: aggStats._sum.totalCost || 0,
    };

    return success(c, {
      campaigns: result,
      stats,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }, "Campaigns fetched");
  } catch (error) {
    return serverError(c, error instanceof Error ? error.message : String(error));
  }
});

// GET /campaigns/:id — campaign detail
campaignRoutes.get("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const [campaign, [statusCounts, channelCounts]] = await Promise.all([
      campaignRepository.findById(id, restaurantId),
      campaignRepository.getDeliveryStatusCounts(id),
    ]);

    if (!campaign) return validationError(c, "Campaign not found");

    const stats = { sent: 0, delivered: 0, failed: 0, pending: 0, whatsapp: 0, sms: 0, total: 0 };
    for (const row of statusCounts) {
      stats.total += row._count;
      if (row.status === DELIVERY_STATUS.SENT) stats.sent = row._count;
      else if (row.status === DELIVERY_STATUS.DELIVERED) stats.delivered = row._count;
      else if (row.status === DELIVERY_STATUS.FAILED) stats.failed = row._count;
      else if (row.status === DELIVERY_STATUS.PENDING) stats.pending = row._count;
    }
    for (const row of channelCounts) {
      if (row.channel === CHANNEL.WHATSAPP) stats.whatsapp = row._count;
      else if (row.channel === CHANNEL.SMS) stats.sms = row._count;
    }

    return success(c, { ...campaign, stats }, "Campaign fetched");
  } catch (error) {
    return serverError(c, error instanceof Error ? error.message : String(error));
  }
});

// POST /campaigns — create draft campaign
campaignRoutes.post("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const body = await c.req.json();
    const campaign = await campaignService.createDraft(restaurantId, body);
    return success(c, campaign, "Campaign created");
  } catch (error) {
    if (error instanceof CampaignError) return validationError(c, error.message);
    return serverError(c, error instanceof Error ? error.message : String(error));
  }
});

// DELETE /campaigns/:id — delete a draft campaign
campaignRoutes.delete("/:id", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");

    const campaign = await campaignRepository.findDeletable(id, restaurantId, [CAMPAIGN_STATUS.DRAFT, CAMPAIGN_STATUS.PAYING]);
    if (!campaign) return validationError(c, "Campaign not found or cannot be deleted");

    await campaignRepository.remove(campaign.id);
    return success(c, null, "Campaign deleted");
  } catch (error) {
    return serverError(c, error instanceof Error ? error.message : String(error));
  }
});

// POST /campaigns/:id/checkout — create Razorpay order for campaign payment
campaignRoutes.post("/:id/checkout", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");
    const result = await campaignService.checkout(id, restaurantId, c.get(CTX.EMAIL));
    return success(c, result, "Campaign checkout created");
  } catch (error) {
    if (error instanceof CampaignError) return validationError(c, error.message);
    return serverError(c, error instanceof Error ? error.message : String(error));
  }
});

// POST /campaigns/:id/verify — verify payment and trigger sending
campaignRoutes.post("/:id/verify", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await campaignService.verifyAndSend(id, restaurantId, body);
    return success(c, result, "Campaign payment verified");
  } catch (error) {
    if (error instanceof CampaignError) return validationError(c, error.message);
    return serverError(c, error instanceof Error ? error.message : String(error));
  }
});
