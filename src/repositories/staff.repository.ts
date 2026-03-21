import { prisma } from "../lib/prisma";

export function findMany(restaurantId: string) {
  return prisma.staff.findMany({
    where: { restaurantId, isDeleted: false },
    orderBy: { createdAt: "asc" as const },
    select: { id: true, employeeId: true, name: true, phone: true, role: true, restaurantId: true, createdAt: true },
  });
}

export function findById(id: string) {
  return prisma.staff.findUnique({ where: { id } });
}

export function findAllActive(restaurantId: string) {
  return prisma.staff.findMany({
    where: { restaurantId, isDeleted: false },
  });
}

export function findAllActiveExcept(restaurantId: string, excludeId: string) {
  return prisma.staff.findMany({
    where: { restaurantId, isDeleted: false, id: { not: excludeId } },
  });
}

export function create(data: Parameters<typeof prisma.staff.create>[0]["data"]) {
  return prisma.staff.create({ data });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.staff.update({ where: { id }, data });
}

export function softDelete(id: string) {
  return prisma.staff.update({
    where: { id },
    data: { isDeleted: true },
  });
}

export function findLastByRestaurant(restaurantId: string) {
  return prisma.staff.findFirst({
    where: { restaurantId },
    orderBy: { createdAt: "desc" as const },
  });
}

export const staffRepository = {
  findMany,
  findById,
  findAllActive,
  findAllActiveExcept,
  create,
  update,
  softDelete,
  findLastByRestaurant,
};
