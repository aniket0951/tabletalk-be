import { prisma } from "../lib/prisma";
import { orderListSelect, orderDetailSelect, orderDetailInclude } from "../lib/order-select";
import { ORDER_STATUS } from "../lib/constants";

export function findMany(where: Record<string, unknown>, options?: { skip?: number; take?: number }) {
  return prisma.order.findMany({
    where,
    select: orderListSelect,
    orderBy: { placedAt: "desc" as const },
    ...(options?.skip !== undefined ? { skip: options.skip } : {}),
    ...(options?.take !== undefined ? { take: options.take } : {}),
  });
}

export function count(where: Record<string, unknown>) {
  return prisma.order.count({ where });
}

export function countByStatus(baseWhere: Record<string, unknown>) {
  return Promise.all([
    prisma.order.count({ where: { ...baseWhere, status: ORDER_STATUS.NEW } }),
    prisma.order.count({ where: { ...baseWhere, status: ORDER_STATUS.COOKING } }),
    prisma.order.count({ where: { ...baseWhere, status: ORDER_STATUS.READY } }),
    prisma.order.count({ where: { ...baseWhere, status: ORDER_STATUS.BILLED } }),
    prisma.order.count({ where: { ...baseWhere, status: ORDER_STATUS.SETTLED } }),
  ]).then(([NEW, COOKING, READY, BILLED, SETTLED]) => ({ NEW, COOKING, READY, BILLED, SETTLED }));
}

export function findById(id: string) {
  return prisma.order.findUnique({ where: { id } });
}

export function findByIdWithDetail(id: string) {
  return prisma.order.findUnique({
    where: { id },
    select: orderDetailSelect,
  });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.order.update({
    where: { id },
    data,
    include: orderDetailInclude,
  });
}

export function create(data: Record<string, unknown>) {
  return prisma.order.create({
    data: data as never,
    include: orderDetailInclude,
  });
}

export function findActiveByTable(tableId: string) {
  return prisma.order.findFirst({
    where: {
      tableId,
      status: { notIn: [ORDER_STATUS.SETTLED] },
      isDeleted: false,
    },
    include: orderDetailInclude,
    orderBy: { placedAt: "desc" as const },
  });
}

export function findActiveByPhone(phone: string) {
  return prisma.order.findMany({
    where: {
      customerPhone: phone,
      status: { notIn: [ORDER_STATUS.SETTLED] },
      isDeleted: false,
    },
    include: orderDetailInclude,
    orderBy: { placedAt: "desc" as const },
  });
}

export function findHistory(phone: string, page: number, limit: number) {
  const where = { customerPhone: phone };
  return Promise.all([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderCode: true,
        status: true,
        total: true,
        placedAt: true,
        customerName: true,
        table: { select: { label: true, tableNumber: true } },
        restaurant: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { placedAt: "desc" as const },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);
}

export function findByIdWithRestaurant(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      ...orderDetailInclude,
      restaurant: { select: { id: true, name: true } },
    },
  });
}

export function findLastByRestaurant(restaurantId: string) {
  return prisma.order.findFirst({
    where: { restaurantId },
    orderBy: { createdAt: "desc" as const },
  });
}

export function countOtherActiveOnTable(tableId: string, excludeOrderId: string) {
  return prisma.order.count({
    where: {
      tableId,
      status: { notIn: [ORDER_STATUS.SETTLED] },
      id: { not: excludeOrderId },
      isDeleted: false,
    },
  });
}

export const orderRepository = {
  findMany,
  count,
  countByStatus,
  findById,
  findByIdWithDetail,
  update,
  create,
  findActiveByTable,
  findActiveByPhone,
  findHistory,
  findByIdWithRestaurant,
  findLastByRestaurant,
  countOtherActiveOnTable,
};
