import { prisma } from "../lib/prisma";

interface UpsertCustomerParams {
  restaurantId: string;
  phone: string;
  name?: string;
  orderTotal: number;
}

export async function upsert({ restaurantId, phone, name, orderTotal }: UpsertCustomerParams): Promise<string | null> {
  if (!phone.trim()) return null;

  const customer = await prisma.customer.upsert({
    where: { restaurantId_phone: { restaurantId, phone } },
    create: {
      phone,
      name: name || "",
      visitCount: 1,
      totalSpent: orderTotal,
      restaurantId,
    },
    update: {
      visitCount: { increment: 1 },
      totalSpent: { increment: orderTotal },
      lastVisitAt: new Date(),
      ...(name ? { name } : {}),
    },
  });

  return customer.id;
}

export function findMany(
  restaurantId: string,
  search: string,
  page: number,
  limit: number
) {
  const where = {
    restaurantId,
    ...(search
      ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { phone: { contains: search } }] }
      : {}),
  };

  return Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { lastVisitAt: "desc" as const },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.customer.count({ where }),
  ]);
}

export function aggregate(restaurantId: string) {
  return Promise.all([
    prisma.customer.aggregate({
      where: { restaurantId },
      _count: true,
      _sum: { totalSpent: true },
    }),
    prisma.customer.count({
      where: { restaurantId, visitCount: { gt: 1 } },
    }),
  ]);
}

export const customerRepository = {
  upsert,
  findMany,
  aggregate,
};
