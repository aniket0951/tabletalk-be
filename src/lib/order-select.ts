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

// Full select for order detail view — includes items, table, staff (name only)
export const orderDetailInclude = {
  items: {
    include: { menuItem: true },
    where: { isDeleted: false },
  },
  table: true,
  staff: { select: { id: true, name: true, role: true } },
} as const;
