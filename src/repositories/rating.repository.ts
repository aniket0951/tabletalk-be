import { prisma } from "../lib/prisma";

export function createWithRecalc(
  data: { orderId: string; menuItemId: string; restaurantId: string; customerId: string; rating: number; note: string },
  tx: typeof prisma = prisma
) {
  return tx.menuItemRating.create({ data });
}

export function aggregateByMenuItem(menuItemId: string, tx: typeof prisma = prisma) {
  return tx.menuItemRating.aggregate({
    where: { menuItemId },
    _avg: { rating: true },
    _count: { rating: true },
  });
}

export function findMany(
  where: { menuItemId: string; rating?: number },
  page: number,
  limit: number
) {
  return Promise.all([
    prisma.menuItemRating.findMany({
      where,
      select: {
        rating: true,
        note: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" as const },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.menuItemRating.count({ where }),
  ]);
}

export const ratingRepository = {
  createWithRecalc,
  aggregateByMenuItem,
  findMany,
};
