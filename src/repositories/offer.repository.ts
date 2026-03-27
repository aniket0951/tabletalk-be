import { prisma } from "../lib/prisma";

export const offerRepository = {
  findMany(restaurantId: string) {
    return prisma.offer.findMany({
      where: { restaurantId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
  },

  findById(id: string) {
    return prisma.offer.findUnique({ where: { id } });
  },

  findActive(restaurantId: string) {
    return prisma.offer.findMany({
      where: { restaurantId, active: true, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
  },

  create(data: {
    restaurantId: string;
    name: string;
    type: "ITEM_DISCOUNT" | "BILL_DISCOUNT";
    discountType: "PERCENTAGE" | "FLAT";
    discountValue: number;
    minOrderAmount?: number | null;
    maxDiscount?: number | null;
    menuItemIds?: string[];
    categoryIds?: string[];
    daysOfWeek?: number[];
    startTime?: string | null;
    endTime?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    promoCode?: string | null;
    usageLimit?: number | null;
  }) {
    return prisma.offer.create({ data });
  },

  update(id: string, data: Record<string, unknown>) {
    return prisma.offer.update({ where: { id }, data });
  },

  softDelete(id: string) {
    return prisma.offer.update({ where: { id }, data: { isDeleted: true, active: false } });
  },

  incrementUsage(id: string) {
    return prisma.offer.update({ where: { id }, data: { usageCount: { increment: 1 } } });
  },

  createOrderDiscount(data: {
    orderId: string;
    offerId: string;
    type: "ITEM_DISCOUNT" | "BILL_DISCOUNT";
    discountAmount: number;
    description: string;
  }) {
    return prisma.orderDiscount.create({ data });
  },

  findOrderDiscounts(orderId: string) {
    return prisma.orderDiscount.findMany({
      where: { orderId },
      include: { offer: { select: { name: true, type: true, discountType: true, discountValue: true } } },
    });
  },

  getStats(id: string) {
    return prisma.orderDiscount.aggregate({
      where: { offerId: id },
      _count: true,
      _sum: { discountAmount: true },
    });
  },
};
