import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "your-secret-key-change-in-production");
const COOKIE_NAME = "staff-token";
const EXPIRY = "12h";

export interface StaffJwtPayload {
  staffId: string;
  restaurantId: string;
  name: string;
  role: string;
}

export async function createStaffToken(payload: StaffJwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(EXPIRY)
    .setIssuedAt()
    .sign(SECRET);
}

export async function verifyStaffTokenFromCookie(c: Context): Promise<StaffJwtPayload | null> {
  try {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return null;

    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as StaffJwtPayload;
  } catch {
    return null;
  }
}

export function setStaffCookie(c: Context, token: string) {
  const isProduction = process.env.NODE_ENV === "production";
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    maxAge: 12 * 60 * 60,
    path: "/",
  });
}

export function clearStaffCookie(c: Context) {
  const isProduction = process.env.NODE_ENV === "production";
  deleteCookie(c, COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
    path: "/",
  });
}
