import { prisma } from "./prisma";

interface UpsertCustomerParams {
  restaurantId: string;
  phone: string;
  name?: string;
  orderTotal: number;
}

export async function upsertCustomer({ restaurantId, phone, name, orderTotal }: UpsertCustomerParams): Promise<string | null> {
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
