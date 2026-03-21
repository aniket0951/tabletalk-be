import { prisma } from "../lib/prisma";

export function findMany(restaurantId: string, page: number, limit: number) {
  const where = { restaurantId };
  return Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" as const },
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
}

export function findById(id: string, restaurantId: string) {
  return prisma.campaign.findFirst({
    where: { id, restaurantId },
  });
}

export function create(data: Parameters<typeof prisma.campaign.create>[0]["data"]) {
  return prisma.campaign.create({ data });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.campaign.update({ where: { id }, data });
}

export function remove(id: string) {
  return prisma.campaign.delete({ where: { id } });
}

export function findDeletable(id: string, restaurantId: string, statuses: string[]) {
  return prisma.campaign.findFirst({
    where: { id, restaurantId, status: { in: statuses as never } },
  });
}

export function getDeliveryCounts(campaignIds: string[]) {
  if (campaignIds.length === 0) return Promise.resolve([]);
  return prisma.campaignDelivery.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaignIds } },
    _count: true,
  });
}

export function getDeliveryStatusCounts(campaignId: string) {
  return Promise.all([
    prisma.campaignDelivery.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: true,
    }),
    prisma.campaignDelivery.groupBy({
      by: ["channel"],
      where: { campaignId },
      _count: true,
    }),
  ]);
}

export const campaignRepository = {
  findMany,
  findById,
  create,
  update,
  remove,
  findDeletable,
  getDeliveryCounts,
  getDeliveryStatusCounts,
};
