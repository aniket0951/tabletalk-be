import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import { upsert, findMany, aggregate } from "../customer.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsert", () => {
  it("returns null for empty phone", async () => {
    const result = await upsert({ restaurantId: "rest-1", phone: "  ", orderTotal: 100 });
    expect(result).toBeNull();
    expect(prismaMock.customer.upsert).not.toHaveBeenCalled();
  });

  it("creates or updates customer", async () => {
    prismaMock.customer.upsert.mockResolvedValue({ id: "cust-1" });

    const result = await upsert({
      restaurantId: "rest-1",
      phone: "1234567890",
      name: "John",
      orderTotal: 500,
    });

    expect(result).toBe("cust-1");
    expect(prismaMock.customer.upsert).toHaveBeenCalledWith({
      where: { restaurantId_phone: { restaurantId: "rest-1", phone: "1234567890" } },
      create: expect.objectContaining({
        phone: "1234567890",
        name: "John",
        visitCount: 1,
        totalSpent: 500,
      }),
      update: expect.objectContaining({
        visitCount: { increment: 1 },
        totalSpent: { increment: 500 },
      }),
    });
  });

  it("creates with empty name when not provided", async () => {
    prismaMock.customer.upsert.mockResolvedValue({ id: "cust-1" });

    await upsert({ restaurantId: "rest-1", phone: "1234567890", orderTotal: 100 });

    expect(prismaMock.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ name: "" }),
      })
    );
  });
});

describe("findMany", () => {
  it("returns customers and count", async () => {
    prismaMock.customer.findMany.mockResolvedValue([{ id: "c-1" }]);
    prismaMock.customer.count.mockResolvedValue(1);

    const [customers, count] = await findMany("rest-1", "", 1, 20);

    expect(customers).toHaveLength(1);
    expect(count).toBe(1);
  });

  it("adds search filter for name and phone", async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    prismaMock.customer.count.mockResolvedValue(0);

    await findMany("rest-1", "john", 1, 20);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          restaurantId: "rest-1",
          OR: [
            { name: { contains: "john", mode: "insensitive" } },
            { phone: { contains: "john" } },
          ],
        },
      })
    );
  });

  it("skips search filter when empty", async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);
    prismaMock.customer.count.mockResolvedValue(0);

    await findMany("rest-1", "", 1, 20);

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: "rest-1" },
      })
    );
  });
});

describe("aggregate", () => {
  it("returns stats and repeat customer count", async () => {
    prismaMock.customer.aggregate.mockResolvedValue({
      _count: 50,
      _sum: { totalSpent: 25000 },
    });
    prismaMock.customer.count.mockResolvedValue(20);

    const [stats, repeatCount] = await aggregate("rest-1");

    expect(stats._count).toBe(50);
    expect(stats._sum.totalSpent).toBe(25000);
    expect(repeatCount).toBe(20);
    expect(prismaMock.customer.count).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1", visitCount: { gt: 1 } },
    });
  });
});
