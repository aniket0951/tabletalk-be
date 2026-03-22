import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { rateLimit } from "../middleware/rate-limit";
import { CTX } from "../lib/constants";
import { authService, AuthError } from "../services/auth.service";
import type { Env } from "../types";
import { success, validationError, serverError } from "../lib/response";

export const authRoutes = new Hono<Env>();

// POST /auth/register — 5 attempts per 15 minutes
authRoutes.post("/register", rateLimit(5, 15 * 60 * 1000), async (c) => {
  try {
    const { name, email, password } = await c.req.json();
    const result = await authService.register(name, email, password);
    return success(c, result, "Registered successfully");
  } catch (err) {
    if (err instanceof AuthError) return validationError(c, err.message);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// POST /auth/login — 10 attempts per 15 minutes
authRoutes.post("/login", rateLimit(10, 15 * 60 * 1000), async (c) => {
  try {
    const { email, password } = await c.req.json();
    const result = await authService.login(email, password);
    return success(c, result, "Logged in");
  } catch (err) {
    if (err instanceof AuthError) return validationError(c, err.message);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});

// GET /auth/me
authRoutes.get("/me", ownerAuth, async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);
    const user = await authService.getMe(userId);
    return success(c, user, "User fetched");
  } catch (err) {
    if (err instanceof AuthError) return validationError(c, err.message);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
