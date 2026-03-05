import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { emitSocketEvent } from "../lib/socket";
import type { Env } from "../types";

export const staffRoutes = new Hono<Env>();

staffRoutes.use("*", ownerAuth);

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

    const existing = await prisma.staff.findFirst({
      where: { restaurantId: restaurant.id, pin, isDeleted: false },
    });
    if (existing) {
      return c.json({ error: "PIN already in use by another staff member" }, 400);
    }

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
        pin,
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
      const pinTaken = await prisma.staff.findFirst({
        where: { restaurantId: restaurant.id, pin, isDeleted: false, id: { not: id } },
      });
      if (pinTaken) {
        return c.json({ error: "PIN already in use by another staff member" }, 400);
      }
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (pin !== undefined) data.pin = pin;
    if (role !== undefined) data.role = role;

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
