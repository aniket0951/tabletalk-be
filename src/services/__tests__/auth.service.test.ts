import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    restaurant: { findFirst: vi.fn() },
  },
}));

vi.mock("../../repositories/user.repository", () => ({
  userRepository: {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../lib/jwt", () => ({
  createOwnerToken: vi.fn().mockResolvedValue("mock-token"),
}));

vi.mock("bcryptjs", () => ({
  hash: vi.fn().mockResolvedValue("hashed-password"),
  compare: vi.fn(),
}));

vi.mock("@paralleldrive/cuid2", () => ({
  createId: vi.fn().mockReturnValue("test-cuid"),
}));

import { register, login, getMe, AuthError } from "../auth.service";
import { userRepository } from "../../repositories/user.repository";
import { prisma } from "../../lib/prisma";
import { compare } from "bcryptjs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("register", () => {
  it("throws on missing fields", async () => {
    await expect(register("", "a@b.com", "password")).rejects.toThrow("Missing fields");
    await expect(register("John", "", "password")).rejects.toThrow("Missing fields");
    await expect(register("John", "a@b.com", "")).rejects.toThrow("Missing fields");
  });

  it("throws on short password", async () => {
    await expect(register("John", "a@b.com", "short")).rejects.toThrow(
      "Password must be at least 8 characters"
    );
  });

  it("throws on too long password", async () => {
    await expect(register("John", "a@b.com", "x".repeat(129))).rejects.toThrow("Password too long");
  });

  it("throws on invalid email format", async () => {
    await expect(register("John", "not-email", "password123")).rejects.toThrow("Invalid email format");
  });

  it("throws when email already registered", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({ id: "existing" } as never);
    await expect(register("John", "a@b.com", "password123")).rejects.toThrow(
      "Email already registered"
    );
  });

  it("creates user and returns token", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    vi.mocked(userRepository.create).mockResolvedValue({
      id: "usr_test-cuid",
      name: "John",
      email: "a@b.com",
    } as never);

    const result = await register("John", "a@b.com", "password123");

    expect(result.token).toBe("mock-token");
    expect(result.user.name).toBe("John");
    expect(result.user.email).toBe("a@b.com");
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "usr_test-cuid",
        name: "John",
        email: "a@b.com",
        passwordHash: "hashed-password",
      })
    );
  });
});

describe("login", () => {
  it("throws on missing fields", async () => {
    await expect(login("", "password")).rejects.toThrow("Missing fields");
    await expect(login("a@b.com", "")).rejects.toThrow("Missing fields");
  });

  it("throws when user not found", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
    await expect(login("a@b.com", "password")).rejects.toThrow("Invalid credentials");
  });

  it("throws when password is wrong", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "usr-1",
      passwordHash: "hash",
    } as never);
    vi.mocked(compare).mockResolvedValue(false as never);

    await expect(login("a@b.com", "wrong")).rejects.toThrow("Invalid credentials");
  });

  it("returns token when credentials valid", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "usr-1",
      name: "John",
      email: "a@b.com",
      passwordHash: "hash",
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(prisma.restaurant.findFirst).mockResolvedValue({ id: "rest-1" } as never);

    const result = await login("a@b.com", "password");
    expect(result.token).toBe("mock-token");
    expect(result.user.id).toBe("usr-1");
  });

  it("works for users without restaurant", async () => {
    vi.mocked(userRepository.findByEmail).mockResolvedValue({
      id: "usr-1",
      name: "John",
      email: "a@b.com",
      passwordHash: "hash",
    } as never);
    vi.mocked(compare).mockResolvedValue(true as never);
    vi.mocked(prisma.restaurant.findFirst).mockResolvedValue(null);

    const result = await login("a@b.com", "password");
    expect(result.token).toBe("mock-token");
  });
});

describe("getMe", () => {
  it("throws when user not found", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(getMe("usr-x")).rejects.toThrow("User not found");
  });

  it("throws when user is deleted", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({
      id: "usr-1",
      isDeleted: true,
    } as never);
    await expect(getMe("usr-1")).rejects.toThrow("User not found");
  });

  it("returns user data", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue({
      id: "usr-1",
      name: "John",
      email: "a@b.com",
      isDeleted: false,
    } as never);

    const result = await getMe("usr-1");
    expect(result).toEqual({ id: "usr-1", name: "John", email: "a@b.com" });
  });
});
