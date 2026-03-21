import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@shared/types/prisma";
import {
  IngestExternalMessageSchema,
  IngestSupportMessageInputSchema,
  ThreadStatusSchema,
  UpsertExternalCustomerSchema,
  UpsertExternalThreadSchema,
} from "@shared/types";
import type { IngestExternalMessageInput } from "@shared/types";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../init";
import {
  buildThreadSummary,
  decideDeterministicThreadMatch,
  type ThreadMatchCandidate,
} from "./helpers/thread-matching";
import { dispatchThreadReviewWorkflow } from "../temporal";

const DEFAULT_RECENCY_WINDOW_SECONDS = 50;

async function assertWorkspaceMember(params: {
  prisma: { workspaceMember: { findUnique: Function } };
  workspaceId: string;
  userId: string;
}) {
  const member = await params.prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
    },
  });

  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this workspace" });
  }
}

/**
 * Core ingestion logic — group first, review later.
 *
 * Deterministic matching only (no LLM at ingestion time):
 *   external_thread_id → reply_chain → time_proximity → new_thread
 *
 * After ingestion, dispatches an async review workflow (debounced by threadId)
 * that reviews the thread's messages as a batch and ejects outliers.
 */
async function performIngestion(
  prisma: PrismaClient,
  input: IngestExternalMessageInput,
) {
  const result = await prisma.$transaction(async (tx) => {
    const messageBody = input.messageBody.trim();
    const now = new Date();

    const customer = await tx.customer.upsert({
      where: {
        workspaceId_source_externalCustomerId: {
          workspaceId: input.workspaceId,
          source: input.source,
          externalCustomerId: input.externalCustomerId,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        source: input.source,
        externalCustomerId: input.externalCustomerId,
        displayName: input.customerDisplayName,
        avatarUrl: input.customerAvatarUrl,
        email: input.customerEmail,
      },
      update: {
        displayName: input.customerDisplayName,
        avatarUrl: input.customerAvatarUrl,
        email: input.customerEmail,
      },
    });

    const existingMessage =
      input.externalMessageId
        ? await tx.threadMessage.findFirst({
            where: {
              externalMessageId: input.externalMessageId,
              thread: {
                workspaceId: input.workspaceId,
                source: input.source,
              },
            },
            include: { thread: true },
          })
        : null;

    if (existingMessage) {
      return {
        customer,
        thread: existingMessage.thread,
        message: existingMessage,
        matching: {
          strategy: "external_thread_id" as const,
          confidence: 1,
          issueFingerprint: existingMessage.messageFingerprint ?? "",
          needsReview: false,
        },
      };
    }

    const existingThreadByExternalId =
      input.externalThreadId
        ? await tx.supportThread.findUnique({
            where: {
              workspaceId_source_externalThreadId: {
                workspaceId: input.workspaceId,
                source: input.source,
                externalThreadId: input.externalThreadId,
              },
            },
            select: {
              id: true,
              customerId: true,
              externalThreadId: true,
              issueFingerprint: true,
              summary: true,
              lastMessageAt: true,
              lastInboundAt: true,
            },
          })
        : null;

    const replyChainThread =
      input.inReplyToExternalMessageId
        ? await tx.threadMessage.findFirst({
            where: {
              externalMessageId: input.inReplyToExternalMessageId,
              thread: {
                workspaceId: input.workspaceId,
                source: input.source,
              },
            },
            orderBy: { createdAt: "desc" },
            select: {
              thread: {
                select: {
                  id: true,
                },
              },
            },
          })
        : null;

    // Workspace-wide candidates for time-proximity matching
    const candidateThreads = await tx.supportThread.findMany({
      where: {
        workspaceId: input.workspaceId,
        source: input.source,
        status: { not: "CLOSED" },
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 20,
      select: {
        id: true,
        customerId: true,
        externalThreadId: true,
        issueFingerprint: true,
        summary: true,
        lastMessageAt: true,
        lastInboundAt: true,
      },
    });

    // Fetch workspace recency window config
    const agentConfig = await tx.workspaceAgentConfig.findUnique({
      where: { workspaceId: input.workspaceId },
      select: { threadRecencyWindowMinutes: true },
    });
    const recencyWindowMs =
      (agentConfig?.threadRecencyWindowMinutes ?? 0) > 0
        ? agentConfig!.threadRecencyWindowMinutes * 60 * 1000
        : DEFAULT_RECENCY_WINDOW_SECONDS * 1000;

    const decision = decideDeterministicThreadMatch({
      externalThreadId: input.externalThreadId,
      inReplyToExternalMessageId: input.inReplyToExternalMessageId,
      threadGroupingHint: input.threadGroupingHint,
      messageBody,
      customerId: customer.id,
      recencyWindowMs,
      existingThreadByExternalId: existingThreadByExternalId as ThreadMatchCandidate | null,
      threadIdByReplyChain: replyChainThread?.thread.id ?? null,
      candidates: candidateThreads as ThreadMatchCandidate[],
    });

    const threadTitle = input.title ?? messageBody.slice(0, 80);
    const resolvedExternalThreadId =
      input.externalThreadId ??
      `synthetic-${input.source.toLowerCase()}-${randomUUID()}`;

    const thread =
      decision.threadId
        ? await tx.supportThread.findUnique({
            where: { id: decision.threadId },
          })
        : null;

    if (!thread && decision.threadId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Matched thread no longer exists" });
    }

    const threadRecord =
      thread ??
      (await tx.supportThread.create({
        data: {
          workspaceId: input.workspaceId,
          customerId: customer.id,
          source: input.source,
          externalThreadId: resolvedExternalThreadId,
          title: threadTitle,
          status: "WAITING_REVIEW",
          lastMessageAt: now,
          lastInboundAt: now,
          issueFingerprint: decision.issueFingerprint,
          summary: buildThreadSummary(null, messageBody),
          summaryUpdatedAt: now,
        },
      }));

    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      matching: {
        strategy: decision.strategy,
        confidence: Number(decision.confidence.toFixed(3)),
        issueFingerprint: decision.issueFingerprint,
      },
    };

    const message = await tx.threadMessage.create({
      data: {
        threadId: threadRecord.id,
        direction: "INBOUND",
        body: messageBody,
        externalMessageId: input.externalMessageId,
        inReplyToExternalMessageId: input.inReplyToExternalMessageId,
        messageFingerprint: decision.issueFingerprint,
        senderExternalId: input.externalCustomerId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    const updatedThread = await tx.supportThread.update({
      where: { id: threadRecord.id },
      data: {
        customerId: customer.id,
        title: threadRecord.title ?? threadTitle,
        status: "WAITING_REVIEW",
        issueFingerprint: decision.issueFingerprint,
        lastMessageAt: message.createdAt,
        lastInboundAt: message.createdAt,
        summary: buildThreadSummary(threadRecord.summary, messageBody),
        summaryUpdatedAt: message.createdAt,
      },
    });

    // Dispatch review for time_proximity (may have grouped wrong topic) and new_thread (may match existing)
    const needsReview =
      decision.strategy === "time_proximity" || decision.strategy === "new_thread";

    return {
      customer,
      thread: updatedThread,
      message,
      matching: {
        strategy: decision.strategy,
        confidence: decision.confidence,
        issueFingerprint: decision.issueFingerprint,
        needsReview,
      },
    };
  }, { timeout: 15000 });

  if (result.matching.needsReview) {
    void dispatchThreadReviewWorkflow({
      workspaceId: input.workspaceId,
      source: input.source,
      threadId: result.thread.id,
    }).catch((error: unknown) => {
      console.error("[intake] Failed to dispatch thread review workflow", error);
    });
  }

  return result;
}

export const intakeRouter = createTRPCRouter({
  upsertExternalCustomer: protectedProcedure
    .input(UpsertExternalCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return ctx.prisma.customer.upsert({
        where: {
          workspaceId_source_externalCustomerId: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalCustomerId: input.externalCustomerId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          source: input.source,
          externalCustomerId: input.externalCustomerId,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          email: input.email,
        },
        update: {
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          email: input.email,
        },
      });
    }),

  upsertExternalThread: protectedProcedure
    .input(UpsertExternalThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return ctx.prisma.supportThread.upsert({
        where: {
          workspaceId_source_externalThreadId: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalThreadId: input.externalThreadId,
          },
        },
        create: {
          workspaceId: input.workspaceId,
          customerId: input.customerId,
          source: input.source,
          externalThreadId: input.externalThreadId,
          title: input.title,
          status: input.status,
        },
        update: {
          customerId: input.customerId,
          title: input.title,
          status: input.status,
        },
      });
    }),

  ingestExternalMessage: protectedProcedure
    .input(IngestExternalMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      return performIngestion(ctx.prisma, input);
    }),

  ingestFromChannel: publicProcedure
    .input(IngestSupportMessageInputSchema)
    .mutation(async ({ ctx, input }) => {
      const channelConnection = await ctx.prisma.channelConnection.findUnique({
        where: { id: input.channelConnectionId },
      });

      if (!channelConnection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Channel connection not found: ${input.channelConnectionId}`,
        });
      }

      const source = channelConnection.type === "DISCORD" ? "DISCORD" as const : "API" as const;

      return performIngestion(ctx.prisma, {
        workspaceId: channelConnection.workspaceId,
        source,
        externalCustomerId: input.externalUserId,
        customerDisplayName: input.displayName ?? input.username ?? input.externalUserId,
        messageBody: input.body,
        externalMessageId: input.externalMessageId,
        externalThreadId: input.externalThreadId ?? undefined,
        inReplyToExternalMessageId: input.inReplyToExternalMessageId ?? undefined,
        metadata: input.rawPayload,
      });
    }),

  touchThreadStatusFromIngestion: protectedProcedure
    .input(
      UpsertExternalThreadSchema.pick({
        workspaceId: true,
        source: true,
        externalThreadId: true,
      }).extend({
        status: ThreadStatusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.sessionUserId!;

      await assertWorkspaceMember({
        prisma: ctx.prisma,
        workspaceId: input.workspaceId,
        userId,
      });

      const thread = await ctx.prisma.supportThread.findUnique({
        where: {
          workspaceId_source_externalThreadId: {
            workspaceId: input.workspaceId,
            source: input.source,
            externalThreadId: input.externalThreadId,
          },
        },
      });

      if (!thread) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
      }

      return ctx.prisma.supportThread.update({
        where: { id: thread.id },
        data: { status: input.status },
      });
    }),
});
