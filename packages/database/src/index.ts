import { PrismaClient } from "@shared/types/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

// In production, DATABASE_URL is injected by the runtime (Doppler, etc.).
// In local dev, it comes from .env loaded by the app entry point (Next.js / tsx).
// We do NOT traverse the filesystem here — that pattern is fragile in containers.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("WARN: DATABASE_URL is not defined in process.env");
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
