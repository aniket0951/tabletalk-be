import { prisma } from "../lib/prisma";
import type { TableStatus } from "@prisma/client";

export function findMany(restaurantId: string) {
  return prisma.diningTable.findMany({
    where: { restaurantId, isDeleted: false },
    orderBy: { tableNumber: "asc" as const },
  });
}

export function findById(id: string) {
  return prisma.diningTable.findFirst({ where: { id, isDeleted: false } });
}

export function findByIdWithRestaurant(id: string) {
  return prisma.diningTable.findUnique({
    where: { id },
    include: { restaurant: { select: { id: true, name: true } } },
  });
}

export function findByIdFull(id: string) {
  return prisma.diningTable.findUnique({
    where: { id },
    include: { restaurant: true },
  });
}

export function create(data: { tableNumber: number; label: string; capacity: number; restaurantId: string }) {
  return prisma.diningTable.create({ data });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.diningTable.update({ where: { id }, data });
}

export function softDelete(id: string) {
  return prisma.diningTable.update({
    where: { id },
    data: { isDeleted: true },
  });
}

export function findMaxTableNumber(restaurantId: string) {
  return prisma.diningTable.findFirst({
    where: { restaurantId },
    orderBy: { tableNumber: "desc" as const },
  });
}

export function countByStatus(restaurantId: string, status: TableStatus) {
  return prisma.diningTable.count({
    where: { restaurantId, status },
  });
}

export function countActive(restaurantId: string) {
  return prisma.diningTable.count({
    where: { restaurantId, active: true },
  });
}

export const tableRepository = {
  findMany,
  findById,
  findByIdWithRestaurant,
  findByIdFull,
  create,
  update,
  softDelete,
  findMaxTableNumber,
  countByStatus,
  countActive,
};
