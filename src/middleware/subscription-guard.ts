import { createMiddleware } from "hono/factory";
import { CTX, SUBSCRIPTION_STATUS } from "../lib/constants";
import { subscriptionRepository } from "../repositories/subscription.repository";
import type { Env } from "../types";

export const subscriptionGuard = createMiddleware<Env>(async (c, next) => {
  const restaurantId = c.get(CTX.RESTAURANT_ID);

  const subscription = await subscriptionRepository.findLatest(restaurantId);

  if (!subscription) {
    return c.json({ error: "No subscription", code: "NO_SUBSCRIPTION" }, 402);
  }

  // Check trial expiry
  if (subscription.status === SUBSCRIPTION_STATUS.TRIAL && new Date() > subscription.endDate) {
    await subscriptionRepository.update(subscription.id, { status: SUBSCRIPTION_STATUS.EXPIRED });
    return c.json({ error: "Trial expired", code: "TRIAL_EXPIRED" }, 402);
  }

  const allowedStatuses: string[] = [SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE];
  if (!allowedStatuses.includes(subscription.status)) {
    return c.json(
      { error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE", status: subscription.status },
      402
    );
  }

  await next();
});
