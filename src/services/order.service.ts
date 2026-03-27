import { orderRepository } from "../repositories/order.repository";
import { tableRepository } from "../repositories/table.repository";
import { offerRepository } from "../repositories/offer.repository";
import { emitSocketEvent } from "../lib/socket";
import { upsertCustomer } from "../lib/customer";
import { ORDER_STATUS, TABLE_STATUS, SOCKET_EVENT } from "../lib/constants";
import { calculateDiscounts } from "./offer.service";

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
  promoCode?: string;
  items: { menuItemId: string; quantity: number }[];
}

export async function createOrder(input: CreateOrderInput) {
  const { tableId, customerPhone, customerName, specialNote, promoCode, items } = input;

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

  // Fetch menu items to get prices + categoryId for offer matching
  const { prisma } = await import("../lib/prisma");
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, available: true, isDeleted: false },
    select: { id: true, price: true, categoryId: true },
  });
  if (menuItems.length !== menuItemIds.length) {
    throw new OrderError("Some items are unavailable", 400);
  }

  const priceMap = new Map(menuItems.map((mi) => [mi.id, mi.price]));
  const catMap = new Map(menuItems.map((mi) => [mi.id, mi.categoryId]));

  let subtotal = 0;
  const orderItems = items.map((i) => {
    const unitPrice = priceMap.get(i.menuItemId)!;
    const qty = Math.floor(Number(i.quantity));
    subtotal += unitPrice * qty;
    return { menuItemId: i.menuItemId, quantity: qty, unitPrice };
  });

  // Calculate discounts from active offers
  const activeOffers = await offerRepository.findActive(restaurantId);
  const discountItems = orderItems.map((oi) => ({
    menuItemId: oi.menuItemId,
    categoryId: catMap.get(oi.menuItemId) || "",
    unitPrice: oi.unitPrice,
    quantity: oi.quantity,
  }));
  const { appliedDiscounts, totalDiscount } = calculateDiscounts(
    activeOffers as never[],
    discountItems,
    subtotal,
    promoCode,
  );

  const discount = totalDiscount;
  const tax = Math.round(subtotal * 0.05 * 100) / 100;
  const total = Math.round((subtotal - discount + tax) * 100) / 100;

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
    discount,
    tax,
    total,
    status: ORDER_STATUS.NEW,
    items: { create: orderItems },
  });

  // Record applied discounts and increment usage
  for (const ad of appliedDiscounts) {
    await offerRepository.createOrderDiscount({
      orderId: order.id,
      offerId: ad.offerId,
      type: ad.type,
      discountAmount: ad.discountAmount,
      description: ad.description,
    });
    await offerRepository.incrementUsage(ad.offerId);
  }

  await tableRepository.update(tableId, { status: TABLE_STATUS.OCCUPIED });

  emitSocketEvent(SOCKET_EVENT.ORDER_CREATED, order);
  emitSocketEvent(SOCKET_EVENT.TABLE_UPDATED, { ...table, status: TABLE_STATUS.OCCUPIED });

  return order;
}

const ADDABLE_STATUSES = [ORDER_STATUS.NEW, ORDER_STATUS.COOKING, ORDER_STATUS.READY];
const MAX_ITEMS_PER_ORDER = 50;

export interface AddItemsInput {
  orderId: string;
  customerPhone: string;
  items: { menuItemId: string; quantity: number }[];
}

export async function addItems(input: AddItemsInput) {
  const { orderId, customerPhone, items } = input;

  const order = await orderRepository.findByIdWithItems(orderId);
  if (!order || order.isDeleted) {
    throw new OrderError("Order not found", 404);
  }

  if (!ADDABLE_STATUSES.includes(order.status as typeof ORDER_STATUS.NEW)) {
    throw new OrderError(
      `Cannot add items to an order with status ${order.status}`,
      409,
      "ORDER_NOT_ADDABLE"
    );
  }

  if (order.customerPhone !== customerPhone) {
    throw new OrderError("Phone number does not match the order", 403);
  }

  // Check max items
  const existingCount = order.items.reduce((sum, i) => sum + i.quantity, 0);
  const newCount = items.reduce((sum, i) => sum + i.quantity, 0);
  if (existingCount + newCount > MAX_ITEMS_PER_ORDER) {
    throw new OrderError(`Cannot exceed ${MAX_ITEMS_PER_ORDER} items per order`, 400);
  }

  // Validate menu items
  const { prisma } = await import("../lib/prisma");
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await prisma.menuItem.findMany({
    where: { id: { in: menuItemIds }, available: true, isDeleted: false },
  });
  if (menuItems.length !== menuItemIds.length) {
    throw new OrderError("Some items are unavailable", 400);
  }

  const priceMap = new Map(menuItems.map((mi) => [mi.id, mi.price]));

  let newSubtotal = 0;
  const orderItems = items.map((i) => {
    const unitPrice = priceMap.get(i.menuItemId)!;
    const qty = Math.floor(Number(i.quantity));
    newSubtotal += unitPrice * qty;
    return { menuItemId: i.menuItemId, quantity: qty, unitPrice };
  });

  // Add existing items subtotal
  const existingSubtotal = order.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const totalSubtotal = Math.round((existingSubtotal + newSubtotal) * 100) / 100;

  // Recalculate discounts with all items (existing + new)
  const allItems = [
    ...order.items.map((i) => ({
      menuItemId: i.menuItemId,
      categoryId: "",
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
    ...orderItems.map((oi) => ({
      menuItemId: oi.menuItemId,
      categoryId: "",
      unitPrice: oi.unitPrice,
      quantity: oi.quantity,
    })),
  ];
  const activeOffers = await offerRepository.findActive(order.restaurantId);
  const { totalDiscount } = calculateDiscounts(activeOffers as never[], allItems, totalSubtotal);

  const discount = totalDiscount;
  const tax = Math.round(totalSubtotal * 0.05 * 100) / 100;
  const total = Math.round((totalSubtotal - discount + tax) * 100) / 100;

  // Create new items and update totals
  await orderRepository.addItems(orderId, orderItems);
  const updatedOrder = await orderRepository.updateTotals(orderId, totalSubtotal, tax, total, discount);

  emitSocketEvent(SOCKET_EVENT.ORDER_UPDATED, updatedOrder);

  return updatedOrder;
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
  addItems,
};
