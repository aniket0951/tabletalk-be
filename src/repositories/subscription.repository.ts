import { prisma } from "../lib/prisma";

export function findLatest(restaurantId: string) {
  return prisma.subscription.findFirst({
    where: { restaurantId, isDeleted: false },
    orderBy: { createdAt: "desc" as const },
  });
}

export function create(data: Parameters<typeof prisma.subscription.create>[0]["data"]) {
  return prisma.subscription.create({ data });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.subscription.update({ where: { id }, data });
}

export function findByRazorpayOrderId(razorpayOrderId: string) {
  return prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: razorpayOrderId },
  });
}

export const subscriptionRepository = {
  findLatest,
  create,
  update,
  findByRazorpayOrderId,
};
