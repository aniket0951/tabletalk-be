import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "your-secret-key-change-in-production");

export interface OwnerJwtPayload {
  userId: string;
  email: string;
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
