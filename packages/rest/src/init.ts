import { TRPCError } from "@trpc/server";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { prisma, type PrismaClient } from "@shared/database";

export interface TRPCContext {
  prisma: PrismaClient;
  sessionUserId: string | null;
}

export function createTRPCContext(opts?: { sessionUserId?: string | null }): TRPCContext {
  return { prisma, sessionUserId: opts?.sessionUserId ?? null };
}


const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.sessionUserId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      sessionUserId: ctx.sessionUserId,
    },
  });
});
