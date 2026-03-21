export const CTX = {
  RESTAURANT_ID: "restaurantId",
  USER_ID: "userId",
  EMAIL: "email",
} as const;

export const SUBSCRIPTION_STATUS = {
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  PENDING: "PENDING",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  HALTED: "HALTED",
} as const;

export const INVOICE_STATUS = {
  PAID: "PAID",
} as const;

export const PLAN = {
  STARTER: "STARTER",
  GROWTH: "GROWTH",
  MULTI: "MULTI",
} as const;

export const VALID_PLANS = Object.values(PLAN);

export const ORDER_STATUS = {
  NEW: "NEW",
  COOKING: "COOKING",
  READY: "READY",
  BILLED: "BILLED",
  SETTLED: "SETTLED",
} as const;

export const TABLE_STATUS = {
  FREE: "FREE",
  OCCUPIED: "OCCUPIED",
} as const;

export const CAMPAIGN_STATUS = {
  DRAFT: "DRAFT",
  PAYING: "PAYING",
  SENDING: "SENDING",
  SCHEDULED: "SCHEDULED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export const DELIVERY_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
} as const;

export const CHANNEL = {
  WHATSAPP: "WHATSAPP",
  SMS: "SMS",
} as const;

export const STAFF_ROLE = {
  WAITER: "WAITER",
  CAPTAIN: "CAPTAIN",
} as const;

export const MENU_TYPE = {
  VEG: "VEG",
  NON_VEG: "NON_VEG",
} as const;

export const SERVICE_MODE = {
  DINE_IN: "DINE_IN",
  WALK_IN: "WALK_IN",
} as const;

export const SOCKET_EVENT = {
  ORDER_CREATED: "order:created",
  ORDER_UPDATED: "order:updated",
  TABLE_UPDATED: "table:updated",
  MENU_UPDATED: "menu:updated",
} as const;
