import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
  findMany,
  findById,
  findByIdWithRestaurant,
  create,
  update,
  remove,
  findMaxTableNumber,
  countByStatus,
  countActive,
} from "../table.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findMany", () => {
  it("finds tables ordered by tableNumber", async () => {
    prismaMock.diningTable.findMany.mockResolvedValue([]);
    await findMany("rest-1");
    expect(prismaMock.diningTable.findMany).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1" },
      orderBy: { tableNumber: "asc" },
    });
  });
});

describe("findById", () => {
  it("finds table by id", async () => {
    prismaMock.diningTable.findUnique.mockResolvedValue({ id: "t-1" });
    const result = await findById("t-1");
    expect(result).toEqual({ id: "t-1" });
  });
});

describe("findByIdWithRestaurant", () => {
  it("includes restaurant name", async () => {
    prismaMock.diningTable.findUnique.mockResolvedValue({
      id: "t-1",
      restaurant: { id: "r-1", name: "Test" },
    });
    await findByIdWithRestaurant("t-1");
    expect(prismaMock.diningTable.findUnique).toHaveBeenCalledWith({
      where: { id: "t-1" },
      include: { restaurant: { select: { id: true, name: true } } },
    });
  });
});

describe("create", () => {
  it("creates table with provided data", async () => {
    const data = { tableNumber: 1, label: "A1", capacity: 4, restaurantId: "rest-1" };
    prismaMock.diningTable.create.mockResolvedValue({ id: "t-1", ...data });

    const result = await create(data);
    expect(result.label).toBe("A1");
    expect(prismaMock.diningTable.create).toHaveBeenCalledWith({ data });
  });
});

describe("update", () => {
  it("updates table by id", async () => {
    prismaMock.diningTable.update.mockResolvedValue({ id: "t-1", status: "OCCUPIED" });
    await update("t-1", { status: "OCCUPIED" });
    expect(prismaMock.diningTable.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: { status: "OCCUPIED" },
    });
  });
});

describe("remove", () => {
  it("deletes table by id", async () => {
    prismaMock.diningTable.delete.mockResolvedValue({});
    await remove("t-1");
    expect(prismaMock.diningTable.delete).toHaveBeenCalledWith({ where: { id: "t-1" } });
  });
});

describe("findMaxTableNumber", () => {
  it("finds highest table number", async () => {
    prismaMock.diningTable.findFirst.mockResolvedValue({ tableNumber: 10 });
    const result = await findMaxTableNumber("rest-1");
    expect(result?.tableNumber).toBe(10);
    expect(prismaMock.diningTable.findFirst).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1" },
      orderBy: { tableNumber: "desc" },
    });
  });
});

describe("countByStatus", () => {
  it("counts tables by status", async () => {
    prismaMock.diningTable.count.mockResolvedValue(3);
    const result = await countByStatus("rest-1", "OCCUPIED" as never);
    expect(result).toBe(3);
  });
});

describe("countActive", () => {
  it("counts active tables", async () => {
    prismaMock.diningTable.count.mockResolvedValue(5);
    const result = await countActive("rest-1");
    expect(result).toBe(5);
    expect(prismaMock.diningTable.count).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1", active: true },
    });
  });
});
