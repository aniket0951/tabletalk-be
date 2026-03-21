import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../repositories/menu.repository", () => ({
  menuRepository: {
    findCategoryByIdAndRestaurant: vi.fn(),
    createItem: vi.fn(),
    findMaxSortOrder: vi.fn(),
    createCategory: vi.fn(),
  },
}));

import { createItem, validateItemUpdate, createCategory, MenuError } from "../menu.service";
import { menuRepository } from "../../repositories/menu.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createItem", () => {
  it("throws when name is missing", async () => {
    await expect(
      createItem("rest-1", { name: "", price: 100, categoryId: "cat-1" })
    ).rejects.toThrow(MenuError);
  });

  it("throws when price is missing", async () => {
    await expect(
      createItem("rest-1", { name: "Pasta", price: 0, categoryId: "cat-1" })
    ).rejects.toThrow("Missing fields");
  });

  it("throws when category not found", async () => {
    vi.mocked(menuRepository.findCategoryByIdAndRestaurant).mockResolvedValue(null);
    await expect(
      createItem("rest-1", { name: "Pasta", price: 200, categoryId: "cat-x" })
    ).rejects.toThrow("Category not found");
  });

  it("creates item with defaults", async () => {
    vi.mocked(menuRepository.findCategoryByIdAndRestaurant).mockResolvedValue({ id: "cat-1" } as never);
    vi.mocked(menuRepository.createItem).mockImplementation(async (data: any) => data);

    await createItem("rest-1", { name: "Pasta", price: 250, categoryId: "cat-1" });

    expect(menuRepository.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Pasta",
        description: "",
        price: 250,
        type: "VEG",
        categoryId: "cat-1",
        restaurantId: "rest-1",
      })
    );
  });

  it("uses provided type", async () => {
    vi.mocked(menuRepository.findCategoryByIdAndRestaurant).mockResolvedValue({ id: "cat-1" } as never);
    vi.mocked(menuRepository.createItem).mockImplementation(async (data: any) => data);

    await createItem("rest-1", { name: "Chicken", price: 300, type: "NON_VEG", categoryId: "cat-1" });

    expect(menuRepository.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: "NON_VEG" })
    );
  });
});

describe("validateItemUpdate", () => {
  it("returns validated data for valid input", () => {
    const result = validateItemUpdate({
      name: "Updated Name",
      price: 300,
      type: "NON_VEG",
      available: false,
    });
    expect(result).toEqual({
      name: "Updated Name",
      price: 300,
      type: "NON_VEG",
      available: false,
    });
  });

  it("truncates name to 100 chars", () => {
    const result = validateItemUpdate({ name: "x".repeat(200) });
    expect(result).not.toBeInstanceOf(MenuError);
    expect((result as Record<string, unknown>).name).toHaveLength(100);
  });

  it("truncates description to 500 chars", () => {
    const result = validateItemUpdate({ description: "x".repeat(600) });
    expect((result as Record<string, unknown>).description).toHaveLength(500);
  });

  it("returns MenuError for negative price", () => {
    const result = validateItemUpdate({ price: -10 });
    expect(result).toBeInstanceOf(MenuError);
    expect((result as MenuError).message).toBe("Invalid price (0-100000)");
  });

  it("returns MenuError for price over 100000", () => {
    const result = validateItemUpdate({ price: 200000 });
    expect(result).toBeInstanceOf(MenuError);
  });

  it("returns MenuError for NaN price", () => {
    const result = validateItemUpdate({ price: "abc" });
    expect(result).toBeInstanceOf(MenuError);
  });

  it("returns MenuError for invalid type", () => {
    const result = validateItemUpdate({ type: "VEGAN" });
    expect(result).toBeInstanceOf(MenuError);
    expect((result as MenuError).message).toBe("Invalid type (VEG or NON_VEG)");
  });

  it("returns empty object when no fields provided", () => {
    const result = validateItemUpdate({});
    expect(result).toEqual({});
  });

  it("coerces available to boolean", () => {
    const result = validateItemUpdate({ available: 1 });
    expect((result as Record<string, unknown>).available).toBe(true);
  });
});

describe("createCategory", () => {
  it("throws when name is empty", async () => {
    await expect(createCategory("rest-1", "")).rejects.toThrow("Category name is required");
    await expect(createCategory("rest-1", "  ")).rejects.toThrow("Category name is required");
  });

  it("auto-increments sortOrder", async () => {
    vi.mocked(menuRepository.findMaxSortOrder).mockResolvedValue({
      sortOrder: 3,
    } as never);
    vi.mocked(menuRepository.createCategory).mockImplementation(async (data: any) => data);

    await createCategory("rest-1", "Beverages", "🍺");

    expect(menuRepository.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Beverages",
        emoji: "🍺",
        sortOrder: 4,
        restaurantId: "rest-1",
      })
    );
  });

  it("starts at 0 when no categories exist", async () => {
    vi.mocked(menuRepository.findMaxSortOrder).mockResolvedValue(null);
    vi.mocked(menuRepository.createCategory).mockImplementation(async (data: any) => data);

    await createCategory("rest-1", "Starters");

    expect(menuRepository.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 })
    );
  });

  it("uses default emoji when none provided", async () => {
    vi.mocked(menuRepository.findMaxSortOrder).mockResolvedValue(null);
    vi.mocked(menuRepository.createCategory).mockImplementation(async (data: any) => data);

    await createCategory("rest-1", "Other");

    expect(menuRepository.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: "🍽" })
    );
  });
});
