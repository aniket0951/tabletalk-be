import { prisma } from "../lib/prisma";
import { tableRepository } from "../repositories/table.repository";
import { TABLE_STATUS } from "../lib/constants";

export async function getStats(restaurantId: string) {
  const allOrders = await prisma.order.findMany({
    where: { restaurantId },
  });

  const revenue = allOrders.reduce((sum: number, o: { total: number }) => sum + o.total, 0);
  const count = allOrders.length;
  const avgValue = count > 0 ? Math.round(revenue / count) : 0;

  const [activeTables, totalTables] = await Promise.all([
    tableRepository.countByStatus(restaurantId, TABLE_STATUS.OCCUPIED as never),
    tableRepository.countActive(restaurantId),
  ]);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const weekOrders = await prisma.order.findMany({
    where: { restaurantId, placedAt: { gte: weekStart } },
    select: { placedAt: true, total: true },
  });

  const dailyRevenue: number[] = [];
  const dailyOrderCount: number[] = [];
  const dayLabels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayOrders = weekOrders.filter((o: { placedAt: Date; total: number }) => o.placedAt >= d && o.placedAt < next);
    dailyRevenue.push(dayOrders.reduce((sum: number, o: { total: number }) => sum + o.total, 0));
    dailyOrderCount.push(dayOrders.length);
    dayLabels.push(d.toLocaleDateString("en-IN", { weekday: "short" }));
  }
  const weeklyRevenue = dailyRevenue.reduce((a, b) => a + b, 0);

  const allOrderItems = await prisma.orderItem.findMany({
    where: { order: { restaurantId } },
    include: { menuItem: { select: { name: true } } },
  });

  const itemCounts: Record<string, number> = {};
  allOrderItems.forEach((oi: { menuItem: { name: string }; quantity: number }) => {
    itemCounts[oi.menuItem.name] = (itemCounts[oi.menuItem.name] || 0) + oi.quantity;
  });
  const topItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return {
    revenue,
    orderCount: count,
    avgOrderValue: avgValue,
    activeTables,
    totalTables,
    dailyRevenue,
    dailyOrderCount,
    dayLabels,
    weeklyRevenue,
    topItems,
  };
}

export const dashboardService = {
  getStats,
};
