import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import type { Env } from "../types";

export const customersRoutes = new Hono<Env>();

customersRoutes.use("*", ownerAuth);

// GET /customers
customersRoutes.get("/", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
    const search = c.req.query("search")?.trim() || "";

    const where = {
      restaurantId: restaurant.id,
      ...(search
        ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { phone: { contains: search } }] }
        : {}),
    };

    const [customers, totalFiltered, statsAgg] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { lastVisitAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customer.count({ where }),
      prisma.customer.aggregate({
        where: { restaurantId: restaurant.id },
        _count: true,
        _sum: { totalSpent: true },
      }),
    ]);

    const totalCustomers = statsAgg._count;
    const totalRevenue = statsAgg._sum.totalSpent || 0;
    const avgSpendPerCustomer = totalCustomers ? Math.round(totalRevenue / totalCustomers) : 0;
    const repeatCustomers = await prisma.customer.count({
      where: { restaurantId: restaurant.id, visitCount: { gt: 1 } },
    });

    return c.json({
      customers,
      stats: { totalCustomers, totalRevenue, avgSpendPerCustomer, repeatCustomers },
      pagination: { page, limit, totalFiltered, totalPages: Math.ceil(totalFiltered / limit) },
    });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
