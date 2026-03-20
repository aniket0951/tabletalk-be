import { createMiddleware } from "hono/factory";
import { verifyOwnerToken } from "../lib/jwt";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const ownerAuth = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyOwnerToken(token);
  if (!payload) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set(CTX.USER_ID, payload.userId);
  c.set(CTX.EMAIL, payload.email);
  if (payload.restaurantId) c.set(CTX.RESTAURANT_ID, payload.restaurantId);
  await next();
});
