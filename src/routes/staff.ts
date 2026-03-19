import { Hono } from "hono";
import { hash, compare } from "bcryptjs";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { subscriptionGuard } from "../middleware/subscription-guard";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";

export const staffRoutes = new Hono<Env>();

staffRoutes.use("*", ownerAuth, subscriptionGuard);

// GET /staff
staffRoutes.get("/", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const staff = await prisma.staff.findMany({
      where: { restaurantId: restaurant.id, isDeleted: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, employeeId: true, name: true, phone: true, role: true, restaurantId: true, createdAt: true },
    });

    return c.json(staff);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// POST /staff
staffRoutes.post("/", async (c) => {
  try {
    const userId = c.get("userId");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const { name, phone, pin, role } = await c.req.json();
    if (!name || !pin) {
      return c.json({ error: "Name and PIN are required" }, 400);
    }
    if (!/^\d{4}$/.test(pin)) {
      return c.json({ error: "PIN must be exactly 4 digits" }, 400);
    }

    // Check PIN uniqueness by comparing hashes
    const allStaff = await prisma.staff.findMany({
      where: { restaurantId: restaurant.id, isDeleted: false },
    });
    for (const s of allStaff) {
      if (await compare(pin, s.pin)) {
        return c.json({ error: "PIN already in use by another staff member" }, 400);
      }
    }

    const pinHash = await hash(pin, 10);

    const lastStaff = await prisma.staff.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: "desc" },
    });
    let nextNum = 1;
    if (lastStaff?.employeeId) {
      const match = lastStaff.employeeId.match(/\d+$/);
      if (match) nextNum = parseInt(match[0], 10) + 1;
    }
    const employeeId = `EMP${String(nextNum).padStart(3, "0")}`;

    const staff = await prisma.staff.create({
      data: {
        employeeId,
        name,
        phone: phone || "",
        pin: pinHash,
        role: role || "WAITER",
        restaurantId: restaurant.id,
      },
    });

    emitSocketEvent("staff:created", staff);
    return c.json(staff);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// PATCH /staff/:id
staffRoutes.patch("/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const existing = await prisma.staff.findUnique({ where: { id } });
    if (!existing || existing.restaurantId !== restaurant.id || existing.isDeleted) {
      return c.json({ error: "Not found" }, 404);
    }

    const { name, phone, pin, role } = await c.req.json();

    if (pin !== undefined) {
      if (!/^\d{4}$/.test(pin)) {
        return c.json({ error: "PIN must be exactly 4 digits" }, 400);
      }
      // Check uniqueness against other staff by comparing hashes
      const otherStaff = await prisma.staff.findMany({
        where: { restaurantId: restaurant.id, isDeleted: false, id: { not: id } },
      });
      for (const s of otherStaff) {
        if (await compare(pin, s.pin)) {
          return c.json({ error: "PIN already in use by another staff member" }, 400);
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = String(name).slice(0, 100);
    if (phone !== undefined) data.phone = String(phone).slice(0, 20);
    if (pin !== undefined) data.pin = await hash(pin, 10);
    if (role !== undefined) {
      if (!["WAITER", "CAPTAIN"].includes(role)) {
        return c.json({ error: "Invalid role" }, 400);
      }
      data.role = role;
    }

    const staff = await prisma.staff.update({
      where: { id },
      data,
    });

    emitSocketEvent("staff:updated", staff);
    return c.json(staff);
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});

// DELETE /staff/:id
staffRoutes.delete("/:id", async (c) => {
  try {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const restaurant = await prisma.restaurant.findFirst({
      where: { userId, isDeleted: false },
    });
    if (!restaurant) return c.json({ error: "No restaurant" }, 404);

    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff || staff.restaurantId !== restaurant.id || staff.isDeleted) {
      return c.json({ error: "Not found" }, 404);
    }

    await prisma.staff.update({
      where: { id },
      data: { isDeleted: true },
    });

    emitSocketEvent("staff:deleted", { id });
    return c.json({ success: true });
  } catch {
    return c.json({ error: "Server error" }, 500);
  }
});
