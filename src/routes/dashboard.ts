import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { requireRestaurant } from "../middleware/require-restaurant";
import { CTX } from "../lib/constants";
import { dashboardService } from "../services/dashboard.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";

export const dashboardRoutes = new Hono<Env>();

dashboardRoutes.use("*", ownerAuth, requireRestaurant);

// GET /dashboard/stats
dashboardRoutes.get("/stats", async (c) => {
  try {
    const restaurantId = c.get(CTX.RESTAURANT_ID);
    const stats = await dashboardService.getStats(restaurantId);
    return c.json(stats);
  } catch (err) {
    logger.error("GET /dashboard/stats", err);
    return c.json({ error: "Server error" }, 500);
  }
});
