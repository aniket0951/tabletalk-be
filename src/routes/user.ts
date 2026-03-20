import { Hono } from "hono";
import { prisma } from "../lib/prisma";
import { ownerAuth } from "../middleware/owner-auth";
import { CTX } from "../lib/constants";
import type { Env } from "../types";

export const userRoutes = new Hono<Env>();

userRoutes.use("*", ownerAuth);

// DELETE /user/delete
userRoutes.delete("/delete", async (c) => {
  try {
    const userId = c.get(CTX.USER_ID);

    const restaurants = await prisma.restaurant.findMany({
      where: { userId, isDeleted: false },
      select: { id: true },
    });
    const restaurantIds = restaurants.map((r: { id: string }) => r.id);

    await prisma.$transaction(async (tx) => {
      if (restaurantIds.length > 0) {
        const orderIds = (
          await tx.order.findMany({
            where: { restaurantId: { in: restaurantIds } },
            select: { id: true },
          })
        ).map((o: { id: string }) => o.id);

        if (orderIds.length > 0) {
          await tx.orderItem.updateMany({
            where: { orderId: { in: orderIds } },
            data: { isDeleted: true },
          });
        }

        await tx.order.updateMany({
          where: { restaurantId: { in: restaurantIds } },
          data: { isDeleted: true },
        });

        const subscriptionIds = (
          await tx.subscription.findMany({
            where: { restaurantId: { in: restaurantIds } },
            select: { id: true },
          })
        ).map((s: { id: string }) => s.id);

        if (subscriptionIds.length > 0) {
          await tx.invoice.updateMany({
            where: { subscriptionId: { in: subscriptionIds } },
            data: { isDeleted: true },
          });
        }

        await tx.subscription.updateMany({
          where: { restaurantId: { in: restaurantIds } },
          data: { isDeleted: true },
        });

        const categoryIds = (
          await tx.menuCategory.findMany({
            where: { restaurantId: { in: restaurantIds } },
            select: { id: true },
          })
        ).map((cat: { id: string }) => cat.id);

        if (categoryIds.length > 0) {
          await tx.menuItem.updateMany({
            where: { categoryId: { in: categoryIds } },
            data: { isDeleted: true },
          });
        }

        await tx.menuCategory.updateMany({
          where: { restaurantId: { in: restaurantIds } },
          data: { isDeleted: true },
        });

        await tx.diningTable.updateMany({
          where: { restaurantId: { in: restaurantIds } },
          data: { isDeleted: true },
        });

        await tx.restaurant.updateMany({
          where: { id: { in: restaurantIds } },
          data: { isDeleted: true },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: { isDeleted: true },
      });
    });

    return c.json({ success: true });
  } catch (error) {
    console.log("Delete Account Error:", error);
    return c.json({ error: "Server error" }, 500);
  }
});
