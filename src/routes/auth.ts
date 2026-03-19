import { Hono } from "hono";
import { hash, compare } from "bcryptjs";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "../lib/prisma";
import { createOwnerToken } from "../lib/jwt";
import { ownerAuth } from "../middleware/owner-auth";
import { rateLimit } from "../middleware/rate-limit";
import type { Env } from "../types";

export const authRoutes = new Hono<Env>();

// POST /auth/register — 5 attempts per 15 minutes
authRoutes.post("/register", rateLimit(5, 15 * 60 * 1000), async (c) => {
  try {
    const { name, email, password } = await c.req.json();

    if (!name || !email || !password) {
      return c.json({ error: "Missing fields" }, 400);
    }

    if (typeof password !== "string" || password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters" }, 400);
    }

    if (password.length > 128) {
      return c.json({ error: "Password too long" }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ error: "Invalid email format" }, 400);
    }

    const existing = await prisma.user.findFirst({
      where: { email, isDeleted: false },
    });
    if (existing) {
      return c.json({ error: "Email already registered" }, 400);
    }

    const passwordHash = await hash(password, 12);
    const user = await prisma.user.create({
      data: { id: `usr_${createId()}`, name, email, passwordHash },
    });

    const token = await createOwnerToken({ userId: user.id, email: user.email });

    return c.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.log("Register Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /auth/login — 10 attempts per 15 minutes
authRoutes.post("/login", rateLimit(10, 15 * 60 * 1000), async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: "Missing fields" }, 400);
    }

    const user = await prisma.user.findFirst({
      where: { email, isDeleted: false },
    });
    if (!user) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const isValid = await compare(password, user.passwordHash);
    if (!isValid) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const token = await createOwnerToken({ userId: user.id, email: user.email });

    return c.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.log("Login Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});

// GET /auth/me
authRoutes.get("/me", ownerAuth, async (c) => {
  try {
    const userId = c.get("userId");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user || (user as { isDeleted?: boolean }).isDeleted) {
      return c.json({ error: "User not found" }, 404);
    }
    return c.json(user);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
