import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
  findById,
  findByIdBasic,
  findByIdWithUser,
  create,
  update,
  findByCode,
} from "../restaurant.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findById", () => {
  it("includes table count", async () => {
    prismaMock.restaurant.findUnique.mockResolvedValue({
      id: "r-1",
      name: "Test",
      _count: { tables: 5 },
    });

    const result = await findById("r-1");
    expect(result?._count.tables).toBe(5);
    expect(prismaMock.restaurant.findUnique).toHaveBeenCalledWith({
      where: { id: "r-1" },
      include: { _count: { select: { tables: true } } },
    });
  });
});

describe("findByIdBasic", () => {
  it("finds without includes", async () => {
    prismaMock.restaurant.findUnique.mockResolvedValue({ id: "r-1" });
    const result = await findByIdBasic("r-1");
    expect(result?.id).toBe("r-1");
    expect(prismaMock.restaurant.findUnique).toHaveBeenCalledWith({
      where: { id: "r-1" },
    });
  });
});

describe("findByIdWithUser", () => {
  it("includes user data", async () => {
    prismaMock.restaurant.findUnique.mockResolvedValue({
      id: "r-1",
      user: { id: "u-1", email: "a@b.com" },
    });

    const result = await findByIdWithUser("r-1");
    expect(result?.user.email).toBe("a@b.com");
    expect(prismaMock.restaurant.findUnique).toHaveBeenCalledWith({
      where: { id: "r-1" },
      include: { user: true },
    });
  });
});

describe("create", () => {
  it("creates restaurant", async () => {
    const data = { name: "My Restaurant", phone: "1234567890", userId: "u-1" };
    prismaMock.restaurant.create.mockResolvedValue({ id: "r-1", ...data });
    const result = await create(data as never);
    expect(result.name).toBe("My Restaurant");
  });
});

describe("update", () => {
  it("updates restaurant by id", async () => {
    prismaMock.restaurant.update.mockResolvedValue({ id: "r-1", name: "Updated" });
    await update("r-1", { name: "Updated" });
    expect(prismaMock.restaurant.update).toHaveBeenCalledWith({
      where: { id: "r-1" },
      data: { name: "Updated" },
    });
  });
});

describe("findByCode", () => {
  it("finds restaurant by code", async () => {
    prismaMock.restaurant.findFirst.mockResolvedValue({ id: "r-1", restaurantCode: "ABC123" });
    const result = await findByCode("ABC123");
    expect(result?.restaurantCode).toBe("ABC123");
    expect(prismaMock.restaurant.findFirst).toHaveBeenCalledWith({
      where: { restaurantCode: "ABC123" },
    });
  });

  it("returns null when not found", async () => {
    prismaMock.restaurant.findFirst.mockResolvedValue(null);
    const result = await findByCode("XXXXXX");
    expect(result).toBeNull();
  });
});
