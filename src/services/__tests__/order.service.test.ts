import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing service
vi.mock("../../lib/prisma", () => ({
  prisma: {
    menuItem: { findMany: vi.fn() },
    diningTable: { update: vi.fn() },
    order: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../lib/socket", () => ({
  emitSocketEvent: vi.fn(),
}));

vi.mock("../../lib/customer", () => ({
  upsertCustomer: vi.fn(),
}));

vi.mock("../../repositories/order.repository", () => ({
  orderRepository: {
    findLastByRestaurant: vi.fn(),
    countOtherActiveOnTable: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../repositories/table.repository", () => ({
  tableRepository: {
    findByIdFull: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../repositories/offer.repository", () => ({
  offerRepository: {
    findActive: vi.fn().mockResolvedValue([]),
    createOrderDiscount: vi.fn(),
    incrementUsage: vi.fn(),
  },
}));

import {
  parseDateFilter,
  buildStatusUpdateData,
  validateStatusTransition,
  settleOrder,
  generateOrderCode,
  createOrder,
  OrderError,
} from "../order.service";
import { orderRepository } from "../../repositories/order.repository";
import { tableRepository } from "../../repositories/table.repository";
import { emitSocketEvent } from "../../lib/socket";
import { upsertCustomer } from "../../lib/customer";
import { prisma } from "../../lib/prisma";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseDateFilter", () => {
  it("returns empty object when no dates", () => {
    expect(parseDateFilter()).toEqual({});
  });

  it("parses from date to start of day", () => {
    const result = parseDateFilter("2025-03-15");
    expect(result.gte).toBeInstanceOf(Date);
    expect(result.gte!.getFullYear()).toBe(2025);
    expect(result.gte!.getMonth()).toBe(2); // March = 2
    expect(result.gte!.getDate()).toBe(15);
    expect(result.gte!.getHours()).toBe(0);
  });

  it("parses to date to end of day", () => {
    const result = parseDateFilter(undefined, "2025-03-20");
    expect(result.lte).toBeInstanceOf(Date);
    expect(result.lte!.getHours()).toBe(23);
    expect(result.lte!.getMinutes()).toBe(59);
    expect(result.lte!.getSeconds()).toBe(59);
  });

  it("parses both from and to", () => {
    const result = parseDateFilter("2025-01-01", "2025-12-31");
    expect(result.gte).toBeInstanceOf(Date);
    expect(result.lte).toBeInstanceOf(Date);
    expect(result.gte!.getTime()).toBeLessThan(result.lte!.getTime());
  });
});

describe("buildStatusUpdateData", () => {
  it("sets status and timestamp for COOKING", () => {
    const result = buildStatusUpdateData("COOKING", { confirmedAt: null });
    expect(result.status).toBe("COOKING");
    expect(result.cookingAt).toBeInstanceOf(Date);
    expect(result.confirmedAt).toBeInstanceOf(Date);
  });

  it("does not override existing confirmedAt", () => {
    const existing = { confirmedAt: new Date("2025-01-01") };
    const result = buildStatusUpdateData("COOKING", existing);
    expect(result.confirmedAt).toBeUndefined();
  });

  it("sets readyAt for READY", () => {
    const result = buildStatusUpdateData("READY", { confirmedAt: new Date() });
    expect(result.status).toBe("READY");
    expect(result.readyAt).toBeInstanceOf(Date);
  });

  it("sets billedAt for BILLED", () => {
    const result = buildStatusUpdateData("BILLED", { confirmedAt: new Date() });
    expect(result.billedAt).toBeInstanceOf(Date);
  });

  it("sets settledAt for SETTLED", () => {
    const result = buildStatusUpdateData("SETTLED", { confirmedAt: new Date() });
    expect(result.settledAt).toBeInstanceOf(Date);
  });

  it("handles unknown status without timestamp", () => {
    const result = buildStatusUpdateData("UNKNOWN", { confirmedAt: new Date() });
    expect(result.status).toBe("UNKNOWN");
    expect(Object.keys(result)).toEqual(["status"]);
  });
});

describe("settleOrder", () => {
  it("frees table when no other active orders", async () => {
    vi.mocked(orderRepository.countOtherActiveOnTable).mockResolvedValue(0);
    vi.mocked(tableRepository.update).mockResolvedValue({} as never);

    await settleOrder(
      "order-1",
      { tableId: "table-1", restaurantId: "rest-1" },
      { customerPhone: null, customerName: null, customerId: null, restaurantId: "rest-1", total: 100 }
    );

    expect(orderRepository.countOtherActiveOnTable).toHaveBeenCalledWith("table-1", "order-1");
    expect(tableRepository.update).toHaveBeenCalledWith("table-1", { status: "FREE" });
    expect(emitSocketEvent).toHaveBeenCalledWith("table:updated", { id: "table-1", status: "FREE" });
  });

  it("does not free table when other active orders exist", async () => {
    vi.mocked(orderRepository.countOtherActiveOnTable).mockResolvedValue(2);

    await settleOrder(
      "order-1",
      { tableId: "table-1", restaurantId: "rest-1" },
      { customerPhone: null, customerName: null, customerId: null, restaurantId: "rest-1", total: 100 }
    );

    expect(tableRepository.update).not.toHaveBeenCalled();
  });

  it("upserts customer when phone exists and no customerId", async () => {
    vi.mocked(orderRepository.countOtherActiveOnTable).mockResolvedValue(0);
    vi.mocked(tableRepository.update).mockResolvedValue({} as never);
    vi.mocked(upsertCustomer).mockResolvedValue("cust-1");
    vi.mocked(orderRepository.update).mockResolvedValue({ id: "order-1" } as never);

    const result = await settleOrder(
      "order-1",
      { tableId: "table-1", restaurantId: "rest-1" },
      { customerPhone: "1234567890", customerName: "John", customerId: null, restaurantId: "rest-1", total: 500 }
    );

    expect(upsertCustomer).toHaveBeenCalledWith({
      restaurantId: "rest-1",
      phone: "1234567890",
      name: "John",
      orderTotal: 500,
    });
    expect(orderRepository.update).toHaveBeenCalledWith("order-1", { customerId: "cust-1" });
    expect(result).toEqual({ id: "order-1" });
  });

  it("skips customer upsert when customerId already set", async () => {
    vi.mocked(orderRepository.countOtherActiveOnTable).mockResolvedValue(0);
    vi.mocked(tableRepository.update).mockResolvedValue({} as never);

    await settleOrder(
      "order-1",
      { tableId: "table-1", restaurantId: "rest-1" },
      { customerPhone: "1234567890", customerName: "John", customerId: "cust-existing", restaurantId: "rest-1", total: 500 }
    );

    expect(upsertCustomer).not.toHaveBeenCalled();
  });

  it("skips table update when no tableId", async () => {
    await settleOrder(
      "order-1",
      { tableId: null, restaurantId: "rest-1" },
      { customerPhone: null, customerName: null, customerId: null, restaurantId: "rest-1", total: 100 }
    );

    expect(orderRepository.countOtherActiveOnTable).not.toHaveBeenCalled();
  });
});

describe("generateOrderCode", () => {
  it("returns ORD001 when no previous orders", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    const code = await generateOrderCode("rest-1");
    expect(code).toBe("ORD001");
  });

  it("increments based on count", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(42);
    const code = await generateOrderCode("rest-1");
    expect(code).toBe("ORD043");
  });

  it("pads to 3 digits", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(9);
    const code = await generateOrderCode("rest-1");
    expect(code).toBe("ORD010");
  });
});

describe("createOrder", () => {
  it("throws OrderError when table not found", async () => {
    vi.mocked(tableRepository.findByIdFull).mockResolvedValue(null);

    await expect(
      createOrder({
        tableId: "table-x",
        customerPhone: "1234567890",
        items: [{ menuItemId: "item-1", quantity: 1 }],
      })
    ).rejects.toThrow(OrderError);
  });

  it("throws OrderError when table is occupied", async () => {
    vi.mocked(tableRepository.findByIdFull).mockResolvedValue({
      id: "table-1",
      isDeleted: false,
      status: "OCCUPIED",
      restaurantId: "rest-1",
    } as never);

    await expect(
      createOrder({
        tableId: "table-1",
        customerPhone: "1234567890",
        items: [{ menuItemId: "item-1", quantity: 1 }],
      })
    ).rejects.toThrow("occupied");
  });

  it("throws when some menu items are unavailable", async () => {
    vi.mocked(tableRepository.findByIdFull).mockResolvedValue({
      id: "table-1",
      isDeleted: false,
      status: "FREE",
      restaurantId: "rest-1",
    } as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([]);

    await expect(
      createOrder({
        tableId: "table-1",
        customerPhone: "1234567890",
        items: [{ menuItemId: "item-1", quantity: 1 }],
      })
    ).rejects.toThrow("unavailable");
  });

  it("creates order with correct calculations", async () => {
    vi.mocked(tableRepository.findByIdFull).mockResolvedValue({
      id: "table-1",
      isDeleted: false,
      status: "FREE",
      restaurantId: "rest-1",
    } as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: "item-1", price: 200, categoryId: "cat-1" },
      { id: "item-2", price: 300, categoryId: "cat-1" },
    ] as never);
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    vi.mocked(upsertCustomer).mockResolvedValue("cust-1");
    vi.mocked(orderRepository.create).mockImplementation(async (data: any) => ({
      id: "order-1",
      ...data,
    }));
    vi.mocked(tableRepository.update).mockResolvedValue({} as never);

    const order = await createOrder({
      tableId: "table-1",
      customerPhone: " 1234567890 ",
      customerName: "Alice",
      specialNote: "No spice",
      items: [
        { menuItemId: "item-1", quantity: 2 },
        { menuItemId: "item-2", quantity: 1 },
      ],
    });

    // subtotal = 200*2 + 300*1 = 700
    // tax = 700 * 0.05 = 35
    // total = 735
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderCode: "ORD001",
        subtotal: 700,
        tax: 35,
        total: 735,
        customerPhone: "1234567890",
        customerName: "Alice",
        specialNote: "No spice",
        status: "NEW",
      })
    );
    expect(tableRepository.update).toHaveBeenCalledWith("table-1", { status: "OCCUPIED" });
    expect(emitSocketEvent).toHaveBeenCalledTimes(2); // ORDER_CREATED + TABLE_UPDATED
  });
});

describe("validateStatusTransition", () => {
  it("allows NEW → COOKING", () => {
    expect(validateStatusTransition("NEW", "COOKING")).toBeNull();
  });

  it("allows COOKING → READY", () => {
    expect(validateStatusTransition("COOKING", "READY")).toBeNull();
  });

  it("allows READY → BILLED", () => {
    expect(validateStatusTransition("READY", "BILLED")).toBeNull();
  });

  it("allows BILLED → SETTLED", () => {
    expect(validateStatusTransition("BILLED", "SETTLED")).toBeNull();
  });

  it("rejects NEW → SETTLED (skipping steps)", () => {
    const err = validateStatusTransition("NEW", "SETTLED");
    expect(err).toBe("Cannot transition from NEW to SETTLED");
  });

  it("rejects NEW → BILLED", () => {
    expect(validateStatusTransition("NEW", "BILLED")).not.toBeNull();
  });

  it("rejects COOKING → SETTLED", () => {
    expect(validateStatusTransition("COOKING", "SETTLED")).not.toBeNull();
  });

  it("rejects backward transitions", () => {
    expect(validateStatusTransition("READY", "COOKING")).not.toBeNull();
    expect(validateStatusTransition("SETTLED", "NEW")).not.toBeNull();
    expect(validateStatusTransition("BILLED", "READY")).not.toBeNull();
  });

  it("rejects SETTLED → anything", () => {
    expect(validateStatusTransition("SETTLED", "NEW")).not.toBeNull();
    expect(validateStatusTransition("SETTLED", "COOKING")).not.toBeNull();
  });

  it("rejects unknown statuses", () => {
    expect(validateStatusTransition("UNKNOWN", "NEW")).not.toBeNull();
  });
});

describe("buildStatusUpdateData edge cases", () => {
  it("sets no timestamp for NEW status", () => {
    const result = buildStatusUpdateData("NEW", { confirmedAt: null, status: "NEW" });
    expect(result.status).toBe("NEW");
    expect(Object.keys(result)).toEqual(["status"]);
  });

  it("sets settledAt for SETTLED", () => {
    const result = buildStatusUpdateData("SETTLED", { confirmedAt: new Date(), status: "BILLED" });
    expect(result.settledAt).toBeInstanceOf(Date);
  });
});

describe("settleOrder edge cases", () => {
  it("returns null when upsertCustomer returns null", async () => {
    vi.mocked(orderRepository.countOtherActiveOnTable).mockResolvedValue(0);
    vi.mocked(tableRepository.update).mockResolvedValue({} as never);
    vi.mocked(upsertCustomer).mockResolvedValue(null);

    const result = await settleOrder(
      "order-1",
      { tableId: "table-1", restaurantId: "rest-1" },
      { customerPhone: "1234567890", customerName: null, customerId: null, restaurantId: "rest-1", total: 100 }
    );

    expect(upsertCustomer).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("createOrder edge cases", () => {
  it("throws when table is deleted", async () => {
    vi.mocked(tableRepository.findByIdFull).mockResolvedValue({
      id: "table-1",
      isDeleted: true,
      status: "FREE",
    } as never);

    await expect(
      createOrder({
        tableId: "table-1",
        customerPhone: "1234567890",
        items: [{ menuItemId: "item-1", quantity: 1 }],
      })
    ).rejects.toThrow("Table not found");
  });

  it("uses empty string for customerName when not provided", async () => {
    vi.mocked(tableRepository.findByIdFull).mockResolvedValue({
      id: "table-1",
      isDeleted: false,
      status: "FREE",
      restaurantId: "rest-1",
    } as never);
    vi.mocked(prisma.menuItem.findMany).mockResolvedValue([
      { id: "item-1", price: 100, categoryId: "cat-1" },
    ] as never);
    vi.mocked(prisma.order.count).mockResolvedValue(0);
    vi.mocked(upsertCustomer).mockResolvedValue("cust-1");
    vi.mocked(orderRepository.create).mockImplementation(async (data: any) => ({ id: "o-1", ...data }));
    vi.mocked(tableRepository.update).mockResolvedValue({} as never);

    await createOrder({
      tableId: "table-1",
      customerPhone: "1234567890",
      items: [{ menuItemId: "item-1", quantity: 1 }],
    });

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: "" })
    );
  });
});
