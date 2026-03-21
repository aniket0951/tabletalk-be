import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import {
  findMany,
  findById,
  create,
  update,
  remove,
  findDeletable,
  getDeliveryCounts,
  getDeliveryStatusCounts,
} from "../campaign.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findMany", () => {
  it("returns campaigns, count, and aggregate", async () => {
    const campaigns = [{ id: "c-1" }, { id: "c-2" }];
    prismaMock.campaign.findMany.mockResolvedValue(campaigns);
    prismaMock.campaign.count.mockResolvedValue(2);
    prismaMock.campaign.aggregate.mockResolvedValue({
      _sum: { audienceCount: 100, totalCost: 138 },
      _count: 2,
    });

    const [result, total, agg] = await findMany("rest-1", 1, 20);

    expect(result).toEqual(campaigns);
    expect(total).toBe(2);
    expect(agg._count).toBe(2);
    expect(prismaMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 })
    );
  });

  it("calculates skip for page 2", async () => {
    prismaMock.campaign.findMany.mockResolvedValue([]);
    prismaMock.campaign.count.mockResolvedValue(0);
    prismaMock.campaign.aggregate.mockResolvedValue({ _sum: {}, _count: 0 });

    await findMany("rest-1", 2, 10);

    expect(prismaMock.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });
});

describe("findById", () => {
  it("finds campaign by id and restaurant", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({ id: "c-1" });
    const result = await findById("c-1", "rest-1");
    expect(result?.id).toBe("c-1");
    expect(prismaMock.campaign.findFirst).toHaveBeenCalledWith({
      where: { id: "c-1", restaurantId: "rest-1" },
    });
  });

  it("returns null when not found", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const result = await findById("c-x", "rest-1");
    expect(result).toBeNull();
  });
});

describe("create", () => {
  it("creates campaign", async () => {
    const data = { title: "Sale", restaurantId: "rest-1" };
    prismaMock.campaign.create.mockResolvedValue({ id: "c-1", ...data });
    const result = await create(data as never);
    expect(result.title).toBe("Sale");
  });
});

describe("update", () => {
  it("updates campaign by id", async () => {
    prismaMock.campaign.update.mockResolvedValue({ id: "c-1", status: "SENDING" });
    await update("c-1", { status: "SENDING" });
    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { status: "SENDING" },
    });
  });
});

describe("remove", () => {
  it("deletes campaign by id", async () => {
    prismaMock.campaign.delete.mockResolvedValue({});
    await remove("c-1");
    expect(prismaMock.campaign.delete).toHaveBeenCalledWith({ where: { id: "c-1" } });
  });
});

describe("findDeletable", () => {
  it("finds campaign with matching statuses", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({ id: "c-1", status: "DRAFT" });
    const result = await findDeletable("c-1", "rest-1", ["DRAFT", "PAYING"]);
    expect(result?.id).toBe("c-1");
  });

  it("returns null when no match", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const result = await findDeletable("c-1", "rest-1", ["DRAFT"]);
    expect(result).toBeNull();
  });
});

describe("getDeliveryCounts", () => {
  it("returns empty array for empty campaign ids", async () => {
    const result = await getDeliveryCounts([]);
    expect(result).toEqual([]);
    expect(prismaMock.campaignDelivery.groupBy).not.toHaveBeenCalled();
  });

  it("groups deliveries by campaignId and status", async () => {
    const grouped = [
      { campaignId: "c-1", status: "DELIVERED", _count: 10 },
      { campaignId: "c-1", status: "FAILED", _count: 2 },
    ];
    prismaMock.campaignDelivery.groupBy.mockResolvedValue(grouped);

    const result = await getDeliveryCounts(["c-1"]);
    expect(result).toEqual(grouped);
  });
});

describe("getDeliveryStatusCounts", () => {
  it("returns status and channel counts", async () => {
    const statusCounts = [{ status: "DELIVERED", _count: 5 }];
    const channelCounts = [{ channel: "WHATSAPP", _count: 5 }];
    prismaMock.campaignDelivery.groupBy
      .mockResolvedValueOnce(statusCounts)
      .mockResolvedValueOnce(channelCounts);

    const [statuses, channels] = await getDeliveryStatusCounts("c-1");
    expect(statuses).toEqual(statusCounts);
    expect(channels).toEqual(channelCounts);
  });
});
