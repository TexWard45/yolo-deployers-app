import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { prisma } from "@shared/database";

export function createTRPCContext() {
  return { prisma };
}

export type TRPCContext = ReturnType<typeof createTRPCContext>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;
