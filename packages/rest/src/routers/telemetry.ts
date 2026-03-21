import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../init";
import type { Prisma } from "@shared/types/prisma";

const ReplayEventSchema = z.object({
  type: z.string(),
  timestamp: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()),
  sequence: z.number().int().min(0),
  traceId: z.string().optional(),
  route: z.string().optional(),
});

const IngestInputSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().optional(),
  userAgent: z.string().optional(),
  events: z.array(ReplayEventSchema).min(1).max(500),
});

export const telemetryRouter = createTRPCRouter({
  ingestEvents: publicProcedure
    .input(IngestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { sessionId, userAgent, events } = input;

      // If the request carries an authenticated session, enforce ownership:
      // the caller may not claim events belong to a different user.
      const resolvedUserId = ctx.sessionUserId ?? input.userId ?? null;
      if (ctx.sessionUserId && input.userId && input.userId !== ctx.sessionUserId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "userId in payload does not match authenticated session",
        });
      }

      // rrweb custom events are type 5 in the raw rrweb payload
      const errorEvents = events.filter(
        (e) =>
          e.type === "rrweb" &&
          (e.payload as any)?.type === 5 &&
          (e.payload as any)?.data?.tag === "system_error"
      );

      await ctx.prisma.$transaction([
        ctx.prisma.session.upsert({
          where: { id: sessionId },
          update:
            errorEvents.length > 0
              ? { hasError: true, errorCount: { increment: errorEvents.length } }
              : {},
          create: {
            id: sessionId,
            userId: resolvedUserId,
            userAgent,
            hasError: errorEvents.length > 0,
            errorCount: errorEvents.length,
          },
        }),
        ctx.prisma.replayEvent.createMany({
          data: events.map((event) => ({
            sessionId,
            type: event.type,
            timestamp: event.timestamp,
            payload: event.payload as Prisma.InputJsonValue,
            sequence: event.sequence,
            traceId: event.traceId,
            route: event.route,
          })),
        }),
        ...(errorEvents.length > 0
          ? [
              ctx.prisma.sessionTimeline.createMany({
                data: errorEvents.map((e) => ({
                  sessionId,
                  type: "ERROR",
                  content:
                    (e.payload as any)?.data?.payload?.message ?? "System Error",
                  metadata: e.payload as Prisma.InputJsonValue,
                  timestamp: e.timestamp,
                })),
              }),
            ]
          : []),
      ]);

      return { ingested: events.length, sessionId };
    }),

  listSessions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
        customerId: z.string().optional(),
        customerEmail: z.string().optional(),
        customerPhone: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        hasError: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { limit, cursor, customerId, customerEmail, customerPhone, startDate, endDate, hasError } = input;

      // Resolve session IDs by searching user.identify event payloads
      let sessionIdFilter: string[] | undefined;
      const identityConditions: { payload: { path: string[]; string_contains: string } }[] = [];
      if (customerEmail) identityConditions.push({ payload: { path: ["email"], string_contains: customerEmail } });
      if (customerPhone) identityConditions.push({ payload: { path: ["phone"], string_contains: customerPhone } });
      if (customerId) identityConditions.push({ payload: { path: ["id"], string_contains: customerId } });

      if (identityConditions.length > 0) {
        const matchingEvents = await ctx.prisma.replayEvent.findMany({
          where: { type: "user.identify", OR: identityConditions },
          select: { sessionId: true },
          distinct: ["sessionId"],
        });
        sessionIdFilter = matchingEvents.map((e) => e.sessionId);
        if (sessionIdFilter.length === 0) return { sessions: [], nextCursor: undefined };
      }

      const sessions = await ctx.prisma.session.findMany({
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        where: {
          ...(sessionIdFilter ? { id: { in: sessionIdFilter } } : {}),
          ...(hasError !== undefined ? { hasError } : {}),
          ...(startDate ?? endDate
            ? {
                createdAt: {
                  ...(startDate ? { gte: startDate } : {}),
                  ...(endDate ? { lte: endDate } : {}),
                },
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { events: true } },
        },
      });

      let nextCursor: string | undefined;
      if (sessions.length > limit) {
        const last = sessions.pop();
        nextCursor = last?.id;
      }

      return { sessions, nextCursor };
    }),

  getSessionReplay: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [session, events] = await ctx.prisma.$transaction([
        ctx.prisma.session.findUnique({ where: { id: input.sessionId } }),
        ctx.prisma.replayEvent.findMany({
          where: { sessionId: input.sessionId },
          orderBy: { sequence: "asc" },
          take: 5000,
        }),
      ]);

      return { session, events };
    }),

  getSessionTimeline: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.prisma.sessionTimeline.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { timestamp: "asc" },
      });
    }),

  getSessionByTraceId: protectedProcedure
    .input(z.object({ traceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const links = await ctx.prisma.sessionTraceLink.findMany({
        where: { traceId: input.traceId },
        include: { session: true },
      });

      const sessions = links.map((l) => l.session);

      // Also check events that have this traceId directly
      const eventsWithTrace = await ctx.prisma.replayEvent.findMany({
        where: { traceId: input.traceId },
        select: { sessionId: true },
        distinct: ["sessionId"],
      });

      const sessionIdsFromEvents = eventsWithTrace.map((e) => e.sessionId);
      const linkedSessionIds = new Set(sessions.map((s) => s.id));

      const additionalSessions = sessionIdsFromEvents.filter(
        (id) => !linkedSessionIds.has(id)
      ).length > 0
        ? await ctx.prisma.session.findMany({
            where: {
              id: { in: sessionIdsFromEvents.filter((id) => !linkedSessionIds.has(id)) },
            },
          })
        : [];

      return { sessions: [...sessions, ...additionalSessions] };
    }),
});
