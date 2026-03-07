import { createMiddleware } from "hono/factory";
import { prisma } from "../lib/prisma";
import type { Env } from "../types";

export const subscriptionGuard = createMiddleware<Env>(async (c, next) => {
  const userId = c.get("userId");

  const restaurant = await prisma.restaurant.findFirst({
    where: { userId, isDeleted: false },
  });

  if (!restaurant) {
    return c.json({ error: "No restaurant found" }, 404);
  }

  const subscription = await prisma.subscription.findFirst({
    where: { restaurantId: restaurant.id, isDeleted: false },
    orderBy: { createdAt: "desc" },
  });

  if (!subscription) {
    return c.json({ error: "No subscription", code: "NO_SUBSCRIPTION" }, 402);
  }

  // Check trial expiry
  if (subscription.status === "TRIAL" && new Date() > subscription.endDate) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: "EXPIRED" },
    });
    return c.json({ error: "Trial expired", code: "TRIAL_EXPIRED" }, 402);
  }

  const allowedStatuses = ["TRIAL", "ACTIVE"];
  if (!allowedStatuses.includes(subscription.status)) {
    return c.json(
      { error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE", status: subscription.status },
      402
    );
  }

  await next();
});
