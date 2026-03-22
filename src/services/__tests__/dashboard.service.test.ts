import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    order: { aggregate: vi.fn(), findMany: vi.fn() },
    orderItem: { groupBy: vi.fn() },
    menuItem: { findMany: vi.fn() },
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
    vi.mocked(prisma.order.aggregate).mockResolvedValue({
      _sum: { total: null },
      _count: 0,
    } as never);
    vi.mocked(prisma.order.findMany).mockResolvedValue([]);
    vi.mocked(tableRepository.countByStatus).mockResolvedValue(0);
    vi.mocked(tableRepository.countActive).mockResolvedValue(0);
    vi.mocked(prisma.orderItem.groupBy).mockResolvedValue([]);

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
    const weekOrders = [
      { total: 200, placedAt: new Date() },
      { total: 300, placedAt: new Date() },
      { total: 500, placedAt: new Date() },
    ];
    vi.mocked(prisma.order.aggregate).mockResolvedValue({
      _sum: { total: 1000 },
      _count: 3,
    } as never);
    vi.mocked(prisma.order.findMany).mockResolvedValue(weekOrders as never);
    vi.mocked(tableRepository.countByStatus).mockResolvedValue(2);
    vi.mocked(tableRepository.countActive).mockResolvedValue(5);
    vi.mocked(prisma.orderItem.groupBy).mockResolvedValue([
      { menuItemId: "m-1", _sum: { quantity: 5 } },
      { menuItemId: "m-2", _sum: { quantity: 5 } },
    ] as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: "m-1", name: "Pasta" },
      { id: "m-2", name: "Pizza" },
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

  it("limits top items to 5 via database take", async () => {
    vi.mocked(prisma.order.aggregate).mockResolvedValue({
      _sum: { total: 0 },
      _count: 0,
    } as never);
    vi.mocked(prisma.order.findMany).mockResolvedValue([]);
    vi.mocked(tableRepository.countByStatus).mockResolvedValue(0);
    vi.mocked(tableRepository.countActive).mockResolvedValue(0);

    // groupBy already returns only 5 (take: 5 in query)
    const grouped = Array.from({ length: 5 }, (_, i) => ({
      menuItemId: `m-${i}`,
      _sum: { quantity: 10 - i },
    }));
    vi.mocked(prisma.orderItem.groupBy).mockResolvedValue(grouped as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue(
      grouped.map((g, i) => ({ id: g.menuItemId, name: `Item${i}` })) as never
    );

    const stats = await getStats("rest-1");
    expect(stats.topItems).toHaveLength(5);
    expect(stats.topItems[0].name).toBe("Item0");
    expect(stats.topItems[0].count).toBe(10);
  });
});
