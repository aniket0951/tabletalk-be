import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
  findMany,
  findById,
  findAllActive,
  findAllActiveExcept,
  create,
  update,
  softDelete,
  findLastByRestaurant,
} from "../staff.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findMany", () => {
  it("finds non-deleted staff with lean select", async () => {
    prismaMock.staff.findMany.mockResolvedValue([]);
    await findMany("rest-1");
    expect(prismaMock.staff.findMany).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1", isDeleted: false },
      orderBy: { createdAt: "asc" },
      select: expect.objectContaining({
        id: true,
        employeeId: true,
        name: true,
        role: true,
      }),
    });
  });
});

describe("findById", () => {
  it("finds staff by id", async () => {
    prismaMock.staff.findUnique.mockResolvedValue({ id: "s-1" });
    const result = await findById("s-1");
    expect(result).toEqual({ id: "s-1" });
  });
});

describe("findAllActive", () => {
  it("finds all non-deleted staff", async () => {
    prismaMock.staff.findMany.mockResolvedValue([]);
    await findAllActive("rest-1");
    expect(prismaMock.staff.findMany).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1", isDeleted: false },
    });
  });
});

describe("findAllActiveExcept", () => {
  it("excludes specific staff member", async () => {
    prismaMock.staff.findMany.mockResolvedValue([]);
    await findAllActiveExcept("rest-1", "s-1");
    expect(prismaMock.staff.findMany).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1", isDeleted: false, id: { not: "s-1" } },
    });
  });
});

describe("create", () => {
  it("creates staff member", async () => {
    const data = { employeeId: "EMP001", name: "John", phone: "", pin: "hash", role: "WAITER", restaurantId: "rest-1" };
    prismaMock.staff.create.mockResolvedValue({ id: "s-1", ...data });
    const result = await create(data as never);
    expect(result.employeeId).toBe("EMP001");
  });
});

describe("update", () => {
  it("updates staff by id", async () => {
    prismaMock.staff.update.mockResolvedValue({ id: "s-1", name: "Jane" });
    await update("s-1", { name: "Jane" });
    expect(prismaMock.staff.update).toHaveBeenCalledWith({
      where: { id: "s-1" },
      data: { name: "Jane" },
    });
  });
});

describe("softDelete", () => {
  it("sets isDeleted to true", async () => {
    prismaMock.staff.update.mockResolvedValue({});
    await softDelete("s-1");
    expect(prismaMock.staff.update).toHaveBeenCalledWith({
      where: { id: "s-1" },
      data: { isDeleted: true },
    });
  });
});

describe("findLastByRestaurant", () => {
  it("finds most recent staff", async () => {
    prismaMock.staff.findFirst.mockResolvedValue({ employeeId: "EMP003" });
    const result = await findLastByRestaurant("rest-1");
    expect(result?.employeeId).toBe("EMP003");
  });
});
