import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const dashboardRoutes = new Hono<Env>();

dashboardRoutes.use("*", ownerAuth);

// GET /dashboard/stats
dashboardRoutes.get("/stats", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    if (!restaurantId) return c.json({ error: "No restaurant" }, 404);

    const allOrders = await prisma.order.findMany({
      where: { restaurantId },
    });

    const revenue = allOrders.reduce((sum: number, o: { total: number }) => sum + o.total, 0);
    const count = allOrders.length;
    const avgValue = count > 0 ? Math.round(revenue / count) : 0;

    const activeTables = await prisma.diningTable.count({
      where: { restaurantId: restaurantId, status: "OCCUPIED" },
    });

    const totalTables = await prisma.diningTable.count({
      where: { restaurantId: restaurantId, active: true },
    });

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const weekOrders = await prisma.order.findMany({
      where: {
        restaurantId: restaurantId,
        placedAt: { gte: weekStart },
      },
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
      where: {
        order: { restaurantId: restaurantId },
      },
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

    return c.json({
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
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
