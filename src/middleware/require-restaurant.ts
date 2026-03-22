import { createMiddleware } from "hono/factory";
import { CTX } from "../lib/constants";
import { validationError } from "../lib/response";
import type { Env } from "../types";

export const requireRestaurant = createMiddleware<Env>(async (c, next) => {
  const restaurantId = c.get(CTX.RESTAURANT_ID);
  if (!restaurantId) return validationError(c, "No restaurant found");
  await next();
});
