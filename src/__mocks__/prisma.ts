import { vi } from "vitest";

function createModelMock() {
  return {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
    upsert: vi.fn(),
  };
}

export const prismaMock = {
  user: createModelMock(),
  restaurant: createModelMock(),
  staff: createModelMock(),
  order: createModelMock(),
  orderItem: createModelMock(),
  diningTable: createModelMock(),
  menuItem: createModelMock(),
  menuCategory: createModelMock(),
  menuItemRating: createModelMock(),
  subscription: createModelMock(),
  invoice: createModelMock(),
  customer: createModelMock(),
  campaign: createModelMock(),
  campaignDelivery: createModelMock(),
  razorpayWebhookLog: createModelMock(),
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => Promise<unknown>) => {
    if (typeof fn === "function") return fn(prismaMock);
    return Promise.all(fn);
  }),
};

vi.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));
