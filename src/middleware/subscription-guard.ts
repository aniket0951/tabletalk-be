import { createMiddleware } from "hono/factory";
import { CTX, SUBSCRIPTION_STATUS } from "../lib/constants";
import { subscriptionRepository } from "../repositories/subscription.repository";
import { validationError } from "../lib/response";
import type { Env } from "../types";

export const subscriptionGuard = createMiddleware<Env>(async (c, next) => {
  const restaurantId = c.get(CTX.RESTAURANT_ID);

  const subscription = await subscriptionRepository.findLatest(restaurantId);

  if (!subscription) {
    return validationError(c, "No subscription", "NO_SUBSCRIPTION");
  }

  // Check expiry for both trial and active subscriptions
  if (
    (subscription.status === SUBSCRIPTION_STATUS.TRIAL || subscription.status === SUBSCRIPTION_STATUS.ACTIVE) &&
    new Date() > subscription.endDate
  ) {
    await subscriptionRepository.update(subscription.id, { status: SUBSCRIPTION_STATUS.EXPIRED });
    const code = subscription.status === SUBSCRIPTION_STATUS.TRIAL ? "TRIAL_EXPIRED" : "SUBSCRIPTION_EXPIRED";
    return validationError(c, "Subscription expired", code);
  }

  const allowedStatuses: string[] = [SUBSCRIPTION_STATUS.TRIAL, SUBSCRIPTION_STATUS.ACTIVE];
  if (!allowedStatuses.includes(subscription.status)) {
    return validationError(c, "Subscription inactive", "SUBSCRIPTION_INACTIVE");
  }

  await next();
});
