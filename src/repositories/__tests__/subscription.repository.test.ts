import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
  findLatest,
  create,
  update,
  findByRazorpayOrderId,
} from "../subscription.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findLatest", () => {
  it("finds latest non-deleted subscription", async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({ id: "sub-1", status: "ACTIVE" });

    const result = await findLatest("rest-1");

    expect(result?.status).toBe("ACTIVE");
    expect(prismaMock.subscription.findFirst).toHaveBeenCalledWith({
      where: { restaurantId: "rest-1", isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns null when none exist", async () => {
    prismaMock.subscription.findFirst.mockResolvedValue(null);
    const result = await findLatest("rest-1");
    expect(result).toBeNull();
  });
});

describe("create", () => {
  it("creates subscription", async () => {
    const data = { plan: "STARTER", status: "TRIAL", restaurantId: "rest-1", startDate: new Date(), endDate: new Date() };
    prismaMock.subscription.create.mockResolvedValue({ id: "sub-1", ...data });

    const result = await create(data as never);
    expect(result.plan).toBe("STARTER");
  });
});

describe("update", () => {
  it("updates subscription by id", async () => {
    prismaMock.subscription.update.mockResolvedValue({ id: "sub-1", status: "CANCELLED" });
    await update("sub-1", { status: "CANCELLED" });
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { status: "CANCELLED" },
    });
  });
});

describe("findByRazorpayOrderId", () => {
  it("finds subscription by razorpay order id", async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ id: "sub-1" });
    const result = await findByRazorpayOrderId("order_xyz");
    expect(prismaMock.subscription.findUnique).toHaveBeenCalledWith({
      where: { razorpaySubscriptionId: "order_xyz" },
    });
    expect(result?.id).toBe("sub-1");
  });
});
