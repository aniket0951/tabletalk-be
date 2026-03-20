import { SignJWT, jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export interface OwnerJwtPayload {
  userId: string;
  email: string;
  restaurantId: string | null;
}

export async function createOwnerToken(payload: OwnerJwtPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .setIssuedAt()
    .sign(SECRET);
}

export async function verifyOwnerToken(token: string): Promise<OwnerJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as OwnerJwtPayload;
  } catch {
    return null;
  }
}
