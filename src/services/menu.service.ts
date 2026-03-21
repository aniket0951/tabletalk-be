import { menuRepository } from "../repositories/menu.repository";
import { MENU_TYPE } from "../lib/constants";

export class MenuError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function createItem(
  restaurantId: string,
  data: { name: string; description?: string; price: number; type?: string; categoryId: string }
) {
  if (!data.name || !data.price || !data.categoryId) {
    throw new MenuError("Missing fields", 400);
  }

  const category = await menuRepository.findCategoryByIdAndRestaurant(data.categoryId, restaurantId);
  if (!category) throw new MenuError("Category not found", 404);

  return menuRepository.createItem({
    name: data.name,
    description: data.description || "",
    price: data.price,
    type: (data.type || MENU_TYPE.VEG) as never,
    categoryId: data.categoryId,
    restaurantId,
  });
}

export function validateItemUpdate(body: Record<string, unknown>): Record<string, unknown> | MenuError {
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).slice(0, 100);
  if (body.description !== undefined) data.description = String(body.description).slice(0, 500);
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (isNaN(price) || price < 0 || price > 100000) {
      return new MenuError("Invalid price (0-100000)", 400);
    }
    data.price = price;
  }
  if (body.type !== undefined) {
    if (![MENU_TYPE.VEG, MENU_TYPE.NON_VEG].includes(body.type as never)) {
      return new MenuError("Invalid type (VEG or NON_VEG)", 400);
    }
    data.type = body.type;
  }
  if (body.available !== undefined) data.available = Boolean(body.available);
  return data;
}

export async function createCategory(restaurantId: string, name: string, emoji?: string) {
  if (!name?.trim()) {
    throw new MenuError("Category name is required", 400);
  }

  const maxSort = await menuRepository.findMaxSortOrder(restaurantId);

  return menuRepository.createCategory({
    name: name.trim(),
    emoji: emoji || "\uD83C\uDF7D",
    sortOrder: (maxSort?.sortOrder ?? -1) + 1,
    restaurantId,
  });
}

export const menuService = {
  createItem,
  validateItemUpdate,
  createCategory,
};
