import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
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
} from "../menu.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findCategories", () => {
  it("returns categories with item counts", async () => {
    prismaMock.menuCategory.findMany.mockResolvedValue([]);
    await findCategories("rest-1");
    expect(prismaMock.menuCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: "rest-1" },
        orderBy: { sortOrder: "asc" },
        select: expect.objectContaining({
          id: true,
          name: true,
          _count: expect.any(Object),
        }),
      })
    );
  });
});

describe("findItemsByCategory", () => {
  it("fetches limit+1 for hasMore check", async () => {
    prismaMock.menuItem.findMany.mockResolvedValue([]);
    await findItemsByCategory("cat-1", 1, 20);
    expect(prismaMock.menuItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { categoryId: "cat-1", isDeleted: false },
        skip: 0,
        take: 21, // limit + 1
      })
    );
  });

  it("calculates skip for page 2", async () => {
    prismaMock.menuItem.findMany.mockResolvedValue([]);
    await findItemsByCategory("cat-1", 2, 10);
    expect(prismaMock.menuItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 11 })
    );
  });
});

describe("findAllWithItems", () => {
  it("includes items", async () => {
    prismaMock.menuCategory.findMany.mockResolvedValue([]);
    await findAllWithItems("rest-1");
    expect(prismaMock.menuCategory.findMany).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1" },
      include: { items: true },
      orderBy: { sortOrder: "asc" },
    });
  });
});

describe("findCategoryByIdAndRestaurant", () => {
  it("finds by id and restaurant", async () => {
    prismaMock.menuCategory.findFirst.mockResolvedValue({ id: "cat-1" });
    await findCategoryByIdAndRestaurant("cat-1", "rest-1");
    expect(prismaMock.menuCategory.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-1", restaurantId: "rest-1" },
    });
  });
});

describe("createItem", () => {
  it("creates menu item", async () => {
    prismaMock.menuItem.create.mockResolvedValue({ id: "item-1" });
    await createItem({ name: "Pasta", price: 200 } as never);
    expect(prismaMock.menuItem.create).toHaveBeenCalled();
  });
});

describe("findItemById", () => {
  it("includes category", async () => {
    prismaMock.menuItem.findUnique.mockResolvedValue({ id: "item-1" });
    await findItemById("item-1");
    expect(prismaMock.menuItem.findUnique).toHaveBeenCalledWith({
      where: { id: "item-1" },
      include: { category: true },
    });
  });
});

describe("updateItem", () => {
  it("updates by id", async () => {
    prismaMock.menuItem.update.mockResolvedValue({});
    await updateItem("item-1", { name: "New" });
    expect(prismaMock.menuItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { name: "New" },
    });
  });
});

describe("deleteItem", () => {
  it("soft deletes by setting isDeleted", async () => {
    prismaMock.menuItem.update.mockResolvedValue({});
    await deleteItem("item-1");
    expect(prismaMock.menuItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { isDeleted: true },
    });
  });
});

describe("createCategory", () => {
  it("creates category", async () => {
    prismaMock.menuCategory.create.mockResolvedValue({ id: "cat-1" });
    await createCategory({ name: "Mains", restaurantId: "rest-1" } as never);
    expect(prismaMock.menuCategory.create).toHaveBeenCalled();
  });
});

describe("findMaxSortOrder", () => {
  it("finds highest sort order", async () => {
    prismaMock.menuCategory.findFirst.mockResolvedValue({ sortOrder: 5 });
    const result = await findMaxSortOrder("rest-1");
    expect(result?.sortOrder).toBe(5);
  });
});

describe("countCategories", () => {
  it("counts categories for restaurant", async () => {
    prismaMock.menuCategory.count.mockResolvedValue(3);
    const result = await countCategories("rest-1");
    expect(result).toBe(3);
  });
});

describe("seedDefaults", () => {
  it("creates 3 default categories", async () => {
    prismaMock.menuCategory.createMany.mockResolvedValue({ count: 3 });
    await seedDefaults("rest-1");
    expect(prismaMock.menuCategory.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: "Starters", restaurantId: "rest-1" }),
        expect.objectContaining({ name: "Mains" }),
        expect.objectContaining({ name: "Desserts" }),
      ]),
    });
  });
});
