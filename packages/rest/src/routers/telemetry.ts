import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../init";
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
      const { sessionId, userId, userAgent, events } = input;

      await ctx.prisma.$transaction([
        ctx.prisma.session.upsert({
          where: { id: sessionId },
          update: {},
          create: { id: sessionId, userId, userAgent },
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
      ]);

      return { ingested: events.length, sessionId };
    }),

  listSessions: publicProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.prisma.session.findMany({
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { events: true } },
        },
      });

      let nextCursor: string | undefined;
      if (sessions.length > input.limit) {
        const last = sessions.pop();
        nextCursor = last?.id;
      }

      return { sessions, nextCursor };
    }),

  getSessionReplay: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [session, events] = await ctx.prisma.$transaction([
        ctx.prisma.session.findUnique({ where: { id: input.sessionId } }),
        ctx.prisma.replayEvent.findMany({
          where: { sessionId: input.sessionId },
          orderBy: { sequence: "asc" },
        }),
      ]);

      return { session, events };
    }),

  getSessionTimeline: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return ctx.prisma.sessionTimeline.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { timestamp: "asc" },
      });
    }),

  getSessionByTraceId: publicProcedure
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
