import { describe, it, expect, vi, beforeEach } from "vitest";

const txMock = {
  order: { findMany: vi.fn(), updateMany: vi.fn() },
  orderItem: { updateMany: vi.fn() },
  subscription: { findMany: vi.fn(), updateMany: vi.fn() },
  invoice: { updateMany: vi.fn() },
  menuCategory: { findMany: vi.fn(), updateMany: vi.fn() },
  menuItem: { updateMany: vi.fn() },
  diningTable: { updateMany: vi.fn() },
  restaurant: { updateMany: vi.fn() },
  user: { update: vi.fn() },
};

vi.mock("../../lib/prisma", () => ({
  prisma: {
    restaurant: { findMany: vi.fn() },
    $transaction: vi.fn((fn: any) => fn(txMock)),
  },
}));

import { cascadeDelete } from "../user.service";
import { prisma } from "../../lib/prisma";

beforeEach(() => {
  vi.clearAllMocks();
  // Reset tx mocks
  Object.values(txMock).forEach((model) => {
    Object.values(model).forEach((fn) => (fn as any).mockResolvedValue([]));
  });
});

describe("cascadeDelete", () => {
  it("soft deletes user when no restaurants", async () => {
    vi.mocked(prisma.restaurant.findMany).mockResolvedValue([]);

    await cascadeDelete("usr-1");

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: "usr-1" },
      data: { isDeleted: true },
    });
    expect(txMock.order.updateMany).not.toHaveBeenCalled();
  });

  it("cascades through all related entities", async () => {
    vi.mocked(prisma.restaurant.findMany).mockResolvedValue([
      { id: "rest-1" },
    ] as never);
    txMock.order.findMany.mockResolvedValue([{ id: "ord-1" }, { id: "ord-2" }]);
    txMock.subscription.findMany.mockResolvedValue([{ id: "sub-1" }]);
    txMock.menuCategory.findMany.mockResolvedValue([{ id: "cat-1" }]);

    await cascadeDelete("usr-1");

    // Verify cascade order
    expect(txMock.orderItem.updateMany).toHaveBeenCalledWith({
      where: { orderId: { in: ["ord-1", "ord-2"] } },
      data: { isDeleted: true },
    });
    expect(txMock.order.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: { in: ["rest-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.invoice.updateMany).toHaveBeenCalledWith({
      where: { subscriptionId: { in: ["sub-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.subscription.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: { in: ["rest-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.menuItem.updateMany).toHaveBeenCalledWith({
      where: { categoryId: { in: ["cat-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.menuCategory.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: { in: ["rest-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.diningTable.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: { in: ["rest-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.restaurant.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rest-1"] } },
      data: { isDeleted: true },
    });
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: "usr-1" },
      data: { isDeleted: true },
    });
  });

  it("skips order items when no orders exist", async () => {
    vi.mocked(prisma.restaurant.findMany).mockResolvedValue([
      { id: "rest-1" },
    ] as never);
    txMock.order.findMany.mockResolvedValue([]);
    txMock.subscription.findMany.mockResolvedValue([]);
    txMock.menuCategory.findMany.mockResolvedValue([]);

    await cascadeDelete("usr-1");

    expect(txMock.orderItem.updateMany).not.toHaveBeenCalled();
  });
});
