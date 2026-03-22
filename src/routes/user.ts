import { Hono } from "hono";
import { ownerAuth } from "../middleware/owner-auth";
import { CTX } from "../lib/constants";
import { userService } from "../services/user.service";
import type { Env } from "../types";
import { logger } from "../lib/logger";
import { success, serverError } from "../lib/response";

export const userRoutes = new Hono<Env>();

userRoutes.use("*", ownerAuth);

// DELETE /user/delete
userRoutes.delete("/delete", async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);
    await userService.cascadeDelete(userId);
    return success(c, null, "Account deleted");
  } catch (err) {
    logger.error("DELETE /user/delete", err);
    return serverError(c, err instanceof Error ? err.message : undefined);
  }
});
