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
  shouldEnqueueResolutionWorkflow,
  type ThreadMatchCandidate,
} from "./helpers/thread-matching";
import { dispatchResolveInboxThreadWorkflow } from "../temporal";

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
 * Core ingestion logic shared by both authenticated (ingestExternalMessage)
 * and service-to-service (ingestFromChannel) procedures.
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
          enqueueAsyncResolution: false,
          confidence: 1,
          strategy: "external_thread_id" as const,
          issueFingerprint: existingMessage.messageFingerprint ?? "",
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

    const candidateThreads = await tx.supportThread.findMany({
      where: {
        workspaceId: input.workspaceId,
        customerId: customer.id,
        source: input.source,
        status: { not: "CLOSED" },
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 10,
      select: {
        id: true,
        externalThreadId: true,
        issueFingerprint: true,
        summary: true,
        lastMessageAt: true,
        lastInboundAt: true,
      },
    });

    const deterministicDecision = decideDeterministicThreadMatch({
      externalThreadId: input.externalThreadId,
      inReplyToExternalMessageId: input.inReplyToExternalMessageId,
      threadGroupingHint: input.threadGroupingHint,
      messageBody,
      existingThreadByExternalId: existingThreadByExternalId as ThreadMatchCandidate | null,
      threadIdByReplyChain: replyChainThread?.thread.id ?? null,
      candidates: candidateThreads as ThreadMatchCandidate[],
    });

    const resolvedThreadId = deterministicDecision.threadId;
    const resolvedConfidence = deterministicDecision.confidence;
    const resolvedStrategy = deterministicDecision.strategy;
    const resolvedFingerprint = deterministicDecision.issueFingerprint;
    const enqueueAsyncResolution = shouldEnqueueResolutionWorkflow(
      deterministicDecision,
      candidateThreads.length,
    );

    const threadTitle = input.title ?? messageBody.slice(0, 80);
    const resolvedExternalThreadId =
      input.externalThreadId ??
      `synthetic-${input.source.toLowerCase()}-${randomUUID()}`;

    const thread =
      resolvedThreadId
        ? await tx.supportThread.findUnique({
            where: { id: resolvedThreadId },
          })
        : null;

    if (!thread && resolvedThreadId) {
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
          issueFingerprint: resolvedFingerprint,
          summary: buildThreadSummary(null, messageBody),
          summaryUpdatedAt: now,
        },
      }));

    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      matching: {
        strategy: resolvedStrategy,
        confidence: Number(resolvedConfidence.toFixed(3)),
        requiresReview: deterministicDecision.requiresReview,
        issueFingerprint: resolvedFingerprint,
        enqueueAsyncResolution,
      },
    };

    const message = await tx.threadMessage.create({
      data: {
        threadId: threadRecord.id,
        direction: "INBOUND",
        body: messageBody,
        externalMessageId: input.externalMessageId,
        inReplyToExternalMessageId: input.inReplyToExternalMessageId,
        messageFingerprint: resolvedFingerprint,
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
        issueFingerprint: resolvedFingerprint,
        lastMessageAt: message.createdAt,
        lastInboundAt: message.createdAt,
        summary: buildThreadSummary(threadRecord.summary, messageBody),
        summaryUpdatedAt: message.createdAt,
      },
    });

    return {
      customer,
      thread: updatedThread,
      message,
      matching: {
        enqueueAsyncResolution,
        confidence: resolvedConfidence,
        strategy: resolvedStrategy,
        issueFingerprint: resolvedFingerprint,
      },
    };
  });

  if (result.matching.enqueueAsyncResolution) {
    void dispatchResolveInboxThreadWorkflow({
      workspaceId: input.workspaceId,
      source: input.source,
      customerId: result.customer.id,
      threadId: result.thread.id,
      messageId: result.message.id,
      messageBody: result.message.body,
      issueFingerprint: result.matching.issueFingerprint,
    }).catch((error: unknown) => {
      console.error("[intake] Failed to dispatch resolveInboxThreadWorkflow", error);
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

  /**
   * Public ingestion endpoint for service-to-service calls (e.g. Discord bot).
   * Auth is via the channel connection ID — no user session required.
   */
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
