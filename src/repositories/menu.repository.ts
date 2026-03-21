import { prisma } from "../lib/prisma";

export function findCategories(restaurantId: string) {
  return prisma.menuCategory.findMany({
    where: { restaurantId },
    select: {
      id: true,
      name: true,
      emoji: true,
      sortOrder: true,
      _count: { select: { items: { where: { isDeleted: false } } } },
    },
    orderBy: { sortOrder: "asc" as const },
  });
}

export function findItemsByCategory(categoryId: string, page: number, limit: number) {
  return prisma.menuItem.findMany({
    where: { categoryId, isDeleted: false },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      type: true,
      available: true,
      categoryId: true,
      averageRating: true,
      ratingCount: true,
    },
    orderBy: { createdAt: "asc" as const },
    skip: (page - 1) * limit,
    take: limit + 1,
  });
}

export function findAllWithItems(restaurantId: string) {
  return prisma.menuCategory.findMany({
    where: { restaurantId },
    include: { items: true },
    orderBy: { sortOrder: "asc" as const },
  });
}

export function findCategoryByIdAndRestaurant(categoryId: string, restaurantId: string) {
  return prisma.menuCategory.findFirst({
    where: { id: categoryId, restaurantId },
  });
}

export function createItem(data: Parameters<typeof prisma.menuItem.create>[0]["data"]) {
  return prisma.menuItem.create({ data });
}

export function findItemById(id: string) {
  return prisma.menuItem.findUnique({
    where: { id },
    include: { category: true },
  });
}

export function updateItem(id: string, data: Record<string, unknown>) {
  return prisma.menuItem.update({ where: { id }, data });
}

export function deleteItem(id: string) {
  return prisma.menuItem.delete({ where: { id } });
}

export function createCategory(data: Parameters<typeof prisma.menuCategory.create>[0]["data"]) {
  return prisma.menuCategory.create({ data });
}

export function findMaxSortOrder(restaurantId: string) {
  return prisma.menuCategory.findFirst({
    where: { restaurantId },
    orderBy: { sortOrder: "desc" as const },
  });
}

export function countCategories(restaurantId: string) {
  return prisma.menuCategory.count({ where: { restaurantId } });
}

export function seedDefaults(restaurantId: string) {
  const defaultCategories = [
    { name: "Starters", emoji: "\uD83E\uDD57", sortOrder: 0 },
    { name: "Mains", emoji: "\uD83C\uDF5B", sortOrder: 1 },
    { name: "Desserts", emoji: "\uD83C\uDF70", sortOrder: 2 },
  ];
  return prisma.menuCategory.createMany({
    data: defaultCategories.map((cat) => ({ ...cat, restaurantId })),
  });
}

export const menuRepository = {
  findCategories,
  findItemsByCategory,
  findAllWithItems,
  findCategoryByIdAndRestaurant,
  createItem,
  findItemById,
  updateItem,
  deleteItem,
  createCategory,
  findMaxSortOrder,
  countCategories,
  seedDefaults,
};
