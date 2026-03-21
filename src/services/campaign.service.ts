import { prisma } from "../lib/prisma";
import { getRazorpay, verifyOrderPaymentSignature } from "../lib/razorpay";
import { campaignRepository } from "../repositories/campaign.repository";
import { CAMPAIGN_STATUS, DELIVERY_STATUS, CHANNEL } from "../lib/constants";

export class CampaignError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

const COST_PER_MESSAGE = 1.38;

export async function createDraft(
  restaurantId: string,
  data: { type?: string; title: string; message: string; imageUrl?: string; scheduledAt?: string }
) {
  if (!data.title?.trim() || !data.message?.trim()) {
    throw new CampaignError("Title and message are required", 400);
  }

  const audienceCount = await prisma.customer.count({ where: { restaurantId } });
  if (audienceCount === 0) {
    throw new CampaignError("No customers to target", 400);
  }

  const totalCost = Math.round(audienceCount * COST_PER_MESSAGE * 100) / 100;

  return campaignRepository.create({
    restaurantId,
    type: (data.type || "CUSTOM") as never,
    title: data.title.trim(),
    message: data.message.trim(),
    imageUrl: data.imageUrl || "",
    audienceCount,
    costPerMessage: COST_PER_MESSAGE,
    totalCost,
    status: CAMPAIGN_STATUS.DRAFT,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
  });
}

export async function checkout(campaignId: string, restaurantId: string, email: string) {
  const campaign = await campaignRepository.findDeletable(
    campaignId,
    restaurantId,
    [CAMPAIGN_STATUS.DRAFT, CAMPAIGN_STATUS.PAYING]
  );
  if (!campaign) {
    throw new CampaignError("Campaign not found or already paid", 404);
  }

  const amountInPaise = Math.max(100, Math.round(campaign.totalCost * 100));
  const rzpOrder = await getRazorpay().orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt: `camp_${campaign.id.slice(-8)}`,
    notes: { campaign_id: campaign.id, restaurant_id: restaurantId },
  });

  await campaignRepository.update(campaign.id, {
    razorpayOrderId: rzpOrder.id,
    status: CAMPAIGN_STATUS.PAYING,
  });

  return {
    razorpayOrderId: rzpOrder.id,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    amount: amountInPaise,
    currency: "INR",
    name: "",
    email,
  };
}

export async function verifyAndSend(
  campaignId: string,
  restaurantId: string,
  paymentDetails: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
) {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = paymentDetails;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    throw new CampaignError("Missing payment details", 400);
  }

  const isValid = verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
  if (!isValid) {
    throw new CampaignError("Invalid payment signature", 400);
  }

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, restaurantId, razorpayOrderId: razorpay_order_id },
  });
  if (!campaign) throw new CampaignError("Campaign not found", 404);

  const customers = await prisma.customer.findMany({
    where: { restaurantId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        razorpayPaymentId: razorpay_payment_id,
        status:
          campaign.scheduledAt && new Date(campaign.scheduledAt) > new Date()
            ? CAMPAIGN_STATUS.SCHEDULED
            : CAMPAIGN_STATUS.SENDING,
        sentAt: campaign.scheduledAt ? null : new Date(),
      },
    });

    await tx.campaignDelivery.createMany({
      data: customers.map((cust) => ({
        campaignId: campaign.id,
        customerId: cust.id,
        channel: CHANNEL.WHATSAPP,
        status: DELIVERY_STATUS.PENDING,
      })),
    });
  });

  simulateDelivery(campaign.id);

  return { success: true, message: "Payment verified. Campaign is being sent." };
}

export async function simulateDelivery(campaignId: string) {
  setTimeout(async () => {
    try {
      const deliveries = await prisma.campaignDelivery.findMany({
        where: { campaignId, status: DELIVERY_STATUS.PENDING },
        select: { id: true },
      });

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

      await prisma.$transaction([
        ...(whatsappIds.length > 0
          ? [prisma.campaignDelivery.updateMany({
              where: { id: { in: whatsappIds } },
              data: { status: DELIVERY_STATUS.DELIVERED, channel: CHANNEL.WHATSAPP, sentAt: now, deliveredAt: now },
            })]
          : []),
        ...(smsSuccessIds.length > 0
          ? [prisma.campaignDelivery.updateMany({
              where: { id: { in: smsSuccessIds } },
              data: { status: DELIVERY_STATUS.DELIVERED, channel: CHANNEL.SMS, sentAt: now, deliveredAt: now },
            })]
          : []),
        ...(smsFailIds.length > 0
          ? [prisma.campaignDelivery.updateMany({
              where: { id: { in: smsFailIds } },
              data: { status: DELIVERY_STATUS.FAILED, channel: CHANNEL.SMS, sentAt: now, failReason: "SMS delivery failed" },
            })]
          : []),
        prisma.campaign.update({
          where: { id: campaignId },
          data: { status: CAMPAIGN_STATUS.COMPLETED, completedAt: now },
        }),
      ]);
    } catch {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CAMPAIGN_STATUS.FAILED },
      });
    }
  }, 2000);
}

export const campaignService = {
  createDraft,
  checkout,
  verifyAndSend,
  simulateDelivery,
};
