import { PrismaClient } from "@shared/types/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not defined in process.env");
  }
  // Use an explicit pg.Pool so PrismaPg reuses it instead of creating
  // a new pool on every internal .connect() call.
  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

// Eager init when DATABASE_URL is available (normal case with Doppler).
// Falls back to lazy proxy if env isn't set at import time.
export const prisma: PrismaClient = process.env.DATABASE_URL
  ? getPrisma()
  : new Proxy({} as PrismaClient, {
      get(_target, prop, receiver) {
        const client = getPrisma();
        const value = Reflect.get(client, prop, receiver);
        return typeof value === "function" ? value.bind(client) : value;
      },
    });

export { PrismaClient };
