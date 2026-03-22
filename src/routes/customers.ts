import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX } from "../lib/constants";
import { customerRepository } from "../repositories/customer.repository";
import type { Env } from "../types";
import { logger } from "../lib/logger";

export const customersRoutes = new Hono<Env>();

customersRoutes.use("*", ownerAuth, requireRestaurant);

// GET /customers
customersRoutes.get("/", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "20", 10)));
    const search = c.req.query("search")?.trim() || "";

    const [[customers, totalFiltered], [statsAgg, repeatCustomers]] = await Promise.all([
      customerRepository.findMany(restaurantId, search, page, limit),
      customerRepository.aggregate(restaurantId),
    ]);

    const totalCustomers = statsAgg._count;
    const totalRevenue = statsAgg._sum.totalSpent || 0;
    const avgSpendPerCustomer = totalCustomers ? Math.round(totalRevenue / totalCustomers) : 0;

    return c.json({
      customers,
      stats: { totalCustomers, totalRevenue, avgSpendPerCustomer, repeatCustomers },
      pagination: { page, limit, totalFiltered, totalPages: Math.ceil(totalFiltered / limit) },
    });
  } catch (err) {
    logger.error("GET /customers", err);
    return c.json({ error: "Server error" }, 500);
  }
});
