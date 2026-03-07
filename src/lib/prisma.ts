import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// const DB_URL_FALLBACK = "postgresql://postgres.zduhrhvihzxkfnhwgcyj:%40kodane%40215@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
