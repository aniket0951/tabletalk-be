import { orderRepository } from "../repositories/order.repository";
import { tableRepository } from "../repositories/table.repository";
import { emitSocketEvent } from "../lib/socket";
import { upsertCustomer } from "../lib/customer";
import { ORDER_STATUS, TABLE_STATUS, SOCKET_EVENT } from "../lib/constants";

export const timestampMap: Record<string, string> = {
  COOKING: "cookingAt",
  READY: "readyAt",
  BILLED: "billedAt",
  SETTLED: "settledAt",
};

export function parseDateFilter(from?: string, to?: string): Record<string, Date> {
  const dateFilter: Record<string, Date> = {};
  if (from) {
    const [y, m, d] = from.split("-").map(Number);
    dateFilter.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  if (to) {
    const [y, m, d] = to.split("-").map(Number);
    dateFilter.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  return dateFilter;
}

const validTransitions: Record<string, string[]> = {
  NEW: ["COOKING"],
  COOKING: ["READY"],
  READY: ["BILLED"],
  BILLED: ["SETTLED"],
};

export function validateStatusTransition(currentStatus: string, newStatus: string): string | null {
  const allowed = validTransitions[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    return `Cannot transition from ${currentStatus} to ${newStatus}`;
  }
  return null;
}

export function buildStatusUpdateData(
  newStatus: string,
  existing: { confirmedAt: Date | null; status: string }
): Record<string, unknown> {
  const updateData: Record<string, unknown> = { status: newStatus };
  if (timestampMap[newStatus]) {
    updateData[timestampMap[newStatus]] = new Date();
  }
  if (newStatus === ORDER_STATUS.COOKING && !existing.confirmedAt) {
    updateData.confirmedAt = new Date();
  }
  return updateData;
}

export async function settleOrder(
  orderId: string,
  existing: { tableId: string | null; restaurantId: string },
  order: { customerPhone: string | null; customerName: string | null; customerId: string | null; restaurantId: string; total: number }
) {
  // Free table if no other active orders
  if (existing.tableId) {
    const otherActive = await orderRepository.countOtherActiveOnTable(existing.tableId, orderId);
    if (otherActive === 0) {
      await tableRepository.update(existing.tableId, { status: TABLE_STATUS.FREE });
      emitSocketEvent(SOCKET_EVENT.TABLE_UPDATED, { id: existing.tableId, status: TABLE_STATUS.FREE });
    }
  }

  // Upsert customer
  if (order.customerPhone && !order.customerId) {
    const customerId = await upsertCustomer({
      restaurantId: order.restaurantId,
      phone: order.customerPhone,
      name: order.customerName || undefined,
      orderTotal: order.total,
    });
    if (customerId) {
      return orderRepository.update(orderId, { customerId });
    }
  }
  return null;
}

export async function generateOrderCode(restaurantId: string): Promise<string> {
  const { prisma } = await import("../lib/prisma");
  const countResult = await prisma.order.count({ where: { restaurantId } });
  const nextNum = countResult + 1;
  return `ORD${String(nextNum).padStart(3, "0")}`;
}

export interface CreateOrderInput {
  tableId: string;
  customerPhone: string;
  customerName?: string;
  specialNote?: string;
  items: { menuItemId: string; quantity: number }[];
}

export async function createOrder(input: CreateOrderInput) {
  const { tableId, customerPhone, customerName, specialNote, items } = input;

  const table = await tableRepository.findByIdFull(tableId);
  if (!table || table.isDeleted) {
    throw new OrderError("Table not found", 404);
  }
  if (table.status === TABLE_STATUS.OCCUPIED) {
    throw new OrderError(
      "This table is currently occupied. Please wait for the current order to be settled.",
      409,
      "TABLE_OCCUPIED"
    );
  }

  const restaurantId = table.restaurantId;

  // Fetch menu items to get prices
  const { prisma } = await import("../lib/prisma");
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, available: true, isDeleted: false },
  });
  if (menuItems.length !== menuItemIds.length) {
    throw new OrderError("Some items are unavailable", 400);
  }

  const priceMap = new Map(menuItems.map((mi) => [mi.id, mi.price]));

  let subtotal = 0;
  const orderItems = items.map((i) => {
    const unitPrice = priceMap.get(i.menuItemId)!;
    const qty = Math.floor(Number(i.quantity));
    subtotal += unitPrice * qty;
    return { menuItemId: i.menuItemId, quantity: qty, unitPrice };
  });

  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  const orderCode = await generateOrderCode(restaurantId);

  const customerId = await upsertCustomer({
    restaurantId,
    phone: customerPhone.trim(),
    name: customerName || undefined,
    orderTotal: total,
  });

  const order = await orderRepository.create({
    orderCode,
    tableId,
    restaurantId,
    customerPhone: customerPhone.trim(),
    customerName: customerName || "",
    customerId,
    specialNote: specialNote || "",
    subtotal,
    tax,
    total,
    status: ORDER_STATUS.NEW,
    items: { create: orderItems },
  });

  await tableRepository.update(tableId, { status: TABLE_STATUS.OCCUPIED });

  emitSocketEvent(SOCKET_EVENT.ORDER_CREATED, order);
  emitSocketEvent(SOCKET_EVENT.TABLE_UPDATED, { ...table, status: TABLE_STATUS.OCCUPIED });

  return order;
}

export class OrderError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
  }
}

export const orderService = {
  timestampMap,
  parseDateFilter,
  validateStatusTransition,
  buildStatusUpdateData,
  settleOrder,
  generateOrderCode,
  createOrder,
};
