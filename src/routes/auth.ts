import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { rateLimit } from "../middleware/rate-limit";
import { CTX } from "../lib/constants";
import { authService, AuthError } from "../services/auth.service";
import type { Env } from "../types";

export const authRoutes = new Hono<Env>();

// POST /auth/register — 5 attempts per 15 minutes
authRoutes.post("/register", rateLimit(5, 15 * 60 * 1000), async (c) => {
  try {
    const { name, email, password } = await c.req.json();
    const result = await authService.register(name, email, password);
    return c.json(result);
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /auth/login — 10 attempts per 15 minutes
authRoutes.post("/login", rateLimit(10, 15 * 60 * 1000), async (c) => {
  try {
    const { email, password } = await c.req.json();
    const result = await authService.login(email, password);
    return c.json(result);
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /auth/me
authRoutes.get("/me", ownerAuth, async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);
    const user = await authService.getMe(userId);
    return c.json(user);
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.statusCode as 400);
    return c.json({ error: "Server error" }, 500);
  }
});
