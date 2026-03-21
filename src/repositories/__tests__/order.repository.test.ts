import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
  findMany,
  count,
  countByStatus,
  findById,
  findByIdWithDetail,
  update,
  create,
  findActiveByTable,
  findActiveByPhone,
  findHistory,
  findByIdWithRestaurant,
  findLastByRestaurant,
  countOtherActiveOnTable,
} from "../order.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findMany", () => {
  it("calls prisma with correct where and ordering", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    const where = { restaurantId: "rest-1", status: "NEW" };

    await findMany(where);

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: { placedAt: "desc" },
      })
    );
  });

  it("passes skip and take for pagination", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await findMany({ restaurantId: "rest-1" }, { skip: 20, take: 10 });

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });
});

describe("count", () => {
  it("delegates to prisma.order.count", async () => {
    prismaMock.order.count.mockResolvedValue(42);
    const result = await count({ restaurantId: "rest-1" });
    expect(result).toBe(42);
  });
});

describe("countByStatus", () => {
  it("returns counts for all statuses", async () => {
    prismaMock.order.count
      .mockResolvedValueOnce(5)  // NEW
      .mockResolvedValueOnce(3)  // COOKING
      .mockResolvedValueOnce(2)  // READY
      .mockResolvedValueOnce(1)  // BILLED
      .mockResolvedValueOnce(10); // SETTLED

    const result = await countByStatus({ restaurantId: "rest-1" });

    expect(result).toEqual({
      NEW: 5,
      COOKING: 3,
      READY: 2,
      BILLED: 1,
      SETTLED: 10,
    });
    expect(prismaMock.order.count).toHaveBeenCalledTimes(5);
  });
});

describe("findById", () => {
  it("finds order by id excluding deleted", async () => {
    const order = { id: "ord-1", status: "NEW" };
    prismaMock.order.findFirst.mockResolvedValue(order);

    const result = await findById("ord-1");
    expect(result).toEqual(order);
    expect(prismaMock.order.findFirst).toHaveBeenCalledWith({ where: { id: "ord-1", isDeleted: false } });
  });
});

describe("findByIdWithDetail", () => {
  it("uses orderDetailSelect", async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: "ord-1" });

    await findByIdWithDetail("ord-1");

    expect(prismaMock.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord-1" },
        select: expect.objectContaining({
          orderCode: true,
          status: true,
          items: expect.any(Object),
        }),
      })
    );
  });
});

describe("findActiveByTable", () => {
  it("excludes SETTLED orders", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);

    await findActiveByTable("table-1");

    expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tableId: "table-1",
          status: { notIn: ["SETTLED"] },
          isDeleted: false,
        },
      })
    );
  });
});

describe("findActiveByPhone", () => {
  it("finds active orders for phone", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await findActiveByPhone("1234567890");

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerPhone: "1234567890",
          status: { notIn: ["SETTLED"] },
          isDeleted: false,
        },
      })
    );
  });
});

describe("findHistory", () => {
  it("returns paginated orders and count", async () => {
    prismaMock.order.findMany.mockResolvedValue([{ id: "ord-1" }]);
    prismaMock.order.count.mockResolvedValue(1);

    const [orders, total] = await findHistory("1234567890", 1, 20);

    expect(orders).toHaveLength(1);
    expect(total).toBe(1);
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerPhone: "1234567890" },
        skip: 0,
        take: 20,
      })
    );
  });

  it("calculates skip correctly for page 3", async () => {
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.order.count.mockResolvedValue(0);

    await findHistory("1234567890", 3, 10);

    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });
});

describe("findLastByRestaurant", () => {
  it("finds most recent order", async () => {
    prismaMock.order.findFirst.mockResolvedValue({ orderCode: "ORD005" });

    const result = await findLastByRestaurant("rest-1");

    expect(result).toEqual({ orderCode: "ORD005" });
    expect(prismaMock.order.findFirst).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1" },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("update", () => {
  it("updates order with include", async () => {
    prismaMock.order.update.mockResolvedValue({ id: "ord-1", status: "COOKING" });
    const result = await update("ord-1", { status: "COOKING" });
    expect(result).toEqual({ id: "ord-1", status: "COOKING" });
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ord-1" },
        data: { status: "COOKING" },
      })
    );
  });
});

describe("create", () => {
  it("creates order with include", async () => {
    prismaMock.order.create.mockResolvedValue({ id: "ord-new", orderCode: "ORD001" });
    const result = await create({ orderCode: "ORD001", restaurantId: "rest-1" });
    expect(result).toEqual({ id: "ord-new", orderCode: "ORD001" });
  });
});

describe("findByIdWithRestaurant", () => {
  it("includes restaurant data", async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: "ord-1",
      restaurant: { id: "rest-1", name: "Test" },
    });
    const result = await findByIdWithRestaurant("ord-1");
    expect(result?.restaurant).toEqual({ id: "rest-1", name: "Test" });
  });
});

describe("countOtherActiveOnTable", () => {
  it("excludes the given order and settled status", async () => {
    prismaMock.order.count.mockResolvedValue(0);

    await countOtherActiveOnTable("table-1", "ord-1");

    expect(prismaMock.order.count).toHaveBeenCalledWith({
      where: {
        tableId: "table-1",
        status: { notIn: ["SETTLED"] },
        id: { not: "ord-1" },
        isDeleted: false,
      },
    });
  });
});
