import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import type { Env } from "../types";

export const billingRoutes = new Hono<Env>();

billingRoutes.use("*", ownerAuth);

// GET /billing/subscription
billingRoutes.get("/subscription", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
      include: { subscription: true },
    });

    if (!restaurant) return c.json({ error: "No restaurant" }, 404);
    if (!restaurant.subscription) return c.json({ error: "No subscription" }, 404);

    const daysRemaining = restaurant.subscription.endDate
      ? Math.max(0, Math.ceil((new Date(restaurant.subscription.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;

    return c.json({ ...restaurant.subscription, daysRemaining });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /billing/subscription
billingRoutes.post("/subscription", async (c) => {
  try {
    const userId = c.get("userId");
    const { plan } = await c.req.json();

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const validPlans = ["STARTER", "GROWTH", "MULTI"];
    if (!validPlans.includes(plan)) {
      return c.json({ error: "Invalid plan" }, 400);
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    const subscription = await prisma.subscription.upsert({
      where: { restaurantId: restaurant.id },
      update: { plan, status: "TRIAL", startDate: new Date(), endDate },
      create: {
        plan,
        status: "TRIAL",
        startDate: new Date(),
        endDate,
        restaurantId: restaurant.id,
      },
    });

    return c.json(subscription);
  } catch (error) {
    console.log("Subscription Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});
