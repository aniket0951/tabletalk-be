import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    order: { findMany: vi.fn() },
    orderItem: { findMany: vi.fn() },
  },
}));

vi.mock("../../repositories/table.repository", () => ({
  tableRepository: {
    countByStatus: vi.fn(),
    countActive: vi.fn(),
  },
}));

import { getStats } from "../dashboard.service";
import { prisma } from "../../lib/prisma";
import { tableRepository } from "../../repositories/table.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStats", () => {
  it("returns correct stats for empty restaurant", async () => {
    vi.mocked(prisma.order.findMany)
      .mockResolvedValueOnce([]) // allOrders
      .mockResolvedValueOnce([]); // weekOrders
    vi.mocked(tableRepository.countByStatus).mockResolvedValue(0);
    vi.mocked(tableRepository.countActive).mockResolvedValue(0);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue([]);

    const stats = await getStats("rest-1");

    expect(stats.revenue).toBe(0);
    expect(stats.orderCount).toBe(0);
    expect(stats.avgOrderValue).toBe(0);
    expect(stats.activeTables).toBe(0);
    expect(stats.totalTables).toBe(0);
    expect(stats.dailyRevenue).toHaveLength(7);
    expect(stats.dailyOrderCount).toHaveLength(7);
    expect(stats.dayLabels).toHaveLength(7);
    expect(stats.topItems).toEqual([]);
  });

  it("calculates revenue and averages correctly", async () => {
    const orders = [
      { total: 200, placedAt: new Date() },
      { total: 300, placedAt: new Date() },
      { total: 500, placedAt: new Date() },
    ];
    vi.mocked(prisma.order.findMany)
      .mockResolvedValueOnce(orders as never)
      .mockResolvedValueOnce(orders as never);
    vi.mocked(tableRepository.countByStatus).mockResolvedValue(2);
    vi.mocked(tableRepository.countActive).mockResolvedValue(5);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue([
      { menuItem: { name: "Pasta" }, quantity: 3 },
      { menuItem: { name: "Pizza" }, quantity: 5 },
      { menuItem: { name: "Pasta" }, quantity: 2 },
    ] as never);

    const stats = await getStats("rest-1");

    expect(stats.revenue).toBe(1000);
    expect(stats.orderCount).toBe(3);
    expect(stats.avgOrderValue).toBe(333);
    expect(stats.activeTables).toBe(2);
    expect(stats.totalTables).toBe(5);
    expect(stats.topItems).toEqual([
      { name: "Pasta", count: 5 },
      { name: "Pizza", count: 5 },
    ]);
  });

  it("limits top items to 5", async () => {
    vi.mocked(prisma.order.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(tableRepository.countByStatus).mockResolvedValue(0);
    vi.mocked(tableRepository.countActive).mockResolvedValue(0);

    const items = Array.from({ length: 10 }, (_, i) => ({
      menuItem: { name: `Item${i}` },
      quantity: 10 - i,
    }));
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue(items as never);

    const stats = await getStats("rest-1");
    expect(stats.topItems).toHaveLength(5);
    expect(stats.topItems[0].name).toBe("Item0");
  });
});
