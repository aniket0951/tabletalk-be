import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { CTX } from "../lib/constants";
import { userService } from "../services/user.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";

export const userRoutes = new Hono<Env>();

userRoutes.use("*", ownerAuth);

// DELETE /user/delete
userRoutes.delete("/delete", async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);
    await userService.cascadeDelete(userId);
    return c.json({ success: true });
  } catch (err) {
    logger.error("DELETE /user/delete", err);
    return c.json({ error: "Server error" }, 500);
  }
});
