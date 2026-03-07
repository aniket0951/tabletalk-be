import { createMiddleware } from "hono/factory";
import { verifyStaffToken } from "../lib/staff-jwt";
import type { Env } from "../types";

export const staffAuth = createMiddleware<Env>(async (c, next) => {
  const payload = await verifyStaffToken(c);
  if (!payload) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("staff", payload);
  await next();
});
