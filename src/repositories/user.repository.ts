import { prisma } from "../lib/prisma";

export function findByEmail(email: string) {
  return prisma.user.findFirst({
    where: { email, isDeleted: false },
  });
}

export function findById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export function create(data: Parameters<typeof prisma.user.create>[0]["data"]) {
  return prisma.user.create({ data });
}

export function softDelete(id: string) {
  return prisma.user.update({
    where: { id },
    data: { isDeleted: true },
  });
}

export const userRepository = {
  findByEmail,
  findById,
  create,
  softDelete,
};
