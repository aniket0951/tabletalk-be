import { prisma } from "../lib/prisma";

export function findByRestaurant(restaurantId: string) {
  return prisma.invoice.findMany({
    where: {
      subscription: { restaurantId, isDeleted: false },
      isDeleted: false,
    },
    orderBy: { createdAt: "desc" as const },
  });
}

export function create(data: Parameters<typeof prisma.invoice.create>[0]["data"]) {
  return prisma.invoice.create({ data });
}

export const invoiceRepository = {
  findByRestaurant,
  create,
};
