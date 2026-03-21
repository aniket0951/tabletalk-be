import { prisma } from "../lib/prisma";

export function findById(id: string) {
  return prisma.restaurant.findUnique({
    where: { id },
    include: { _count: { select: { tables: true } } },
  });
}

export function findByIdBasic(id: string) {
  return prisma.restaurant.findUnique({ where: { id } });
}

export function findByIdWithUser(id: string) {
  return prisma.restaurant.findUnique({
    where: { id },
    include: { user: true },
  });
}

export function create(data: Parameters<typeof prisma.restaurant.create>[0]["data"]) {
  return prisma.restaurant.create({ data });
}

export function update(id: string, data: Record<string, unknown>) {
  return prisma.restaurant.update({ where: { id }, data });
}

export function findByCode(code: string) {
  return prisma.restaurant.findFirst({ where: { restaurantCode: code } });
}

export function findByCodeActive(code: string) {
  return prisma.restaurant.findFirst({ where: { restaurantCode: code, isDeleted: false } });
}

export const restaurantRepository = {
  findById,
  findByIdBasic,
  findByIdWithUser,
  create,
  update,
  findByCode,
  findByCodeActive,
};
