import { createMiddleware } from "hono/factory";
import { verifyStaffToken } from "../lib/staff-jwt";
import { authError } from "../lib/response";
import type { Env } from "../types";

export const staffAuth = createMiddleware<Env>(async (c, next) => {
  const payload = await verifyStaffToken(c);
  if (!payload) {
    return authError(c);
  }

  c.set("staff", payload);
  await next();
});
