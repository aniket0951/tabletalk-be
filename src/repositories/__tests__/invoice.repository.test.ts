import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import { findByRestaurant, create } from "../invoice.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findByRestaurant", () => {
  it("finds invoices for restaurant via subscription", async () => {
    const invoices = [{ id: "inv-1" }, { id: "inv-2" }];
    prismaMock.invoice.findMany.mockResolvedValue(invoices);

    const result = await findByRestaurant("rest-1");
    expect(result).toEqual(invoices);
    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith({
      where: {
        subscription: { restaurantId: "rest-1", isDeleted: false },
        isDeleted: false,
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns empty array when none found", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);
    const result = await findByRestaurant("rest-1");
    expect(result).toEqual([]);
  });
});

describe("create", () => {
  it("creates invoice", async () => {
    const data = { invoiceNumber: "INV-1", subscriptionId: "sub-1", amount: 999, status: "PAID" };
    prismaMock.invoice.create.mockResolvedValue({ id: "inv-1", ...data });
    const result = await create(data as never);
    expect(result.invoiceNumber).toBe("INV-1");
  });
});
