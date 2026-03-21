import { hash, compare } from "bcryptjs";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "../lib/prisma";
import { createOwnerToken } from "../lib/jwt";
import { userRepository } from "../repositories/user.repository";

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export async function register(name: string, email: string, password: string) {
  if (!name || !email || !password) {
    throw new AuthError("Missing fields", 400);
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new AuthError("Password must be at least 8 characters", 400);
  }
  if (password.length > 128) {
    throw new AuthError("Password too long", 400);
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AuthError("Invalid email format", 400);
  }

  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new AuthError("Email already registered", 400);
  }

  const passwordHash = await hash(password, 12);
  const user = await userRepository.create({
    id: `usr_${createId()}`,
    name,
    email,
    passwordHash,
  });

  const token = await createOwnerToken({ userId: user.id, email: user.email, restaurantId: null });

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

export async function login(email: string, password: string) {
  if (!email || !password) {
    throw new AuthError("Missing fields", 400);
  }

  const user = await userRepository.findByEmail(email);
  if (!user) {
    throw new AuthError("Invalid credentials", 401);
  }

  const isValid = await compare(password, user.passwordHash);
  if (!isValid) {
    throw new AuthError("Invalid credentials", 401);
  }

  const restaurant = await prisma.restaurant.findFirst({
    where: { userId: user.id, isDeleted: false },
    select: { id: true },
  });

  const token = await createOwnerToken({ userId: user.id, email: user.email, restaurantId: restaurant?.id || null });

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

export async function getMe(userId: string) {
  const user = await userRepository.findById(userId);
  if (!user || user.isDeleted) {
    throw new AuthError("User not found", 404);
  }
  return { id: user.id, name: user.name, email: user.email };
}

export const authService = {
  register,
  login,
  getMe,
};
