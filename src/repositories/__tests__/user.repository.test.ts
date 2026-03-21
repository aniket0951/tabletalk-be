import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "../../__mocks__/prisma";

import { findByEmail, findById, create, softDelete } from "../user.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findByEmail", () => {
  it("finds non-deleted user by email", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "u-1", email: "a@b.com" });
    const result = await findByEmail("a@b.com");
    expect(result?.email).toBe("a@b.com");
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { email: "a@b.com", isDeleted: false },
    });
  });
});

describe("findById", () => {
  it("finds user by id", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u-1" });
    const result = await findById("u-1");
    expect(result?.id).toBe("u-1");
  });
});

describe("create", () => {
  it("creates user", async () => {
    const data = { id: "u-1", name: "John", email: "a@b.com", passwordHash: "hash" };
    prismaMock.user.create.mockResolvedValue(data);
    const result = await create(data as never);
    expect(result.name).toBe("John");
  });
});

describe("softDelete", () => {
  it("sets isDeleted to true", async () => {
    prismaMock.user.update.mockResolvedValue({});
    await softDelete("u-1");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u-1" },
      data: { isDeleted: true },
    });
  });
});
