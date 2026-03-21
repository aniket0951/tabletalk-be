import { createMiddleware } from "hono/factory";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const requireRestaurant = createMiddleware<Env>(async (c, next) => {
  const restaurantId = c.get(CTX.RESTAURANT_ID);
  if (!restaurantId) return c.json({ error: "No restaurant" }, 404);
  await next();
});
