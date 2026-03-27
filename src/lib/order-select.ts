// Lean select for order list views — no full nested objects
export const orderListSelect = {
  id: true,
  orderCode: true,
  status: true,
  total: true,
  placedAt: true,
  customerName: true,
  customerPhone: true,
  staffId: true,
  table: { select: { label: true, tableNumber: true } },
  staff: { select: { name: true } },
  _count: { select: { items: true } },
} as const;

// Lean detail select for order drawer — only what the UI displays
export const orderDetailSelect = {
  id: true,
  orderCode: true,
  status: true,
  subtotal: true,
  discount: true,
  tax: true,
  total: true,
  placedAt: true,
  confirmedAt: true,
  cookingAt: true,
  readyAt: true,
  billedAt: true,
  settledAt: true,
  customerPhone: true,
  customerName: true,
  specialNote: true,
  staffId: true,
  restaurantId: true,
  table: { select: { label: true } },
  staff: { select: { name: true, role: true } },
  items: {
    where: { isDeleted: false },
    select: {
      quantity: true,
      unitPrice: true,
      menuItem: { select: { name: true, type: true } },
    },
  },
} as const;

// Full include for socket broadcast — dashboard/customer/staff pages may need more fields
export const orderDetailInclude = {
  items: {
    where: { isDeleted: false },
    select: {
      quantity: true,
      unitPrice: true,
      menuItemId: true,
      menuItem: { select: { id: true, name: true, type: true, price: true } },
    },
  },
  table: { select: { label: true, tableNumber: true } },
  staff: { select: { id: true, name: true, role: true } },
} as const;
