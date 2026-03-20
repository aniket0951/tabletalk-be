import { createMiddleware } from "hono/factory";
import { verifyOwnerToken } from "../lib/jwt";
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

  c.set("userId", payload.userId);
  c.set("email", payload.email);
  if (payload.restaurantId) c.set("restaurantId", payload.restaurantId);
  await next();
});
