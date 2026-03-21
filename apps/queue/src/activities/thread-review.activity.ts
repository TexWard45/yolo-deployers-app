import { prisma } from "@shared/database";
import { reviewThreadMessages } from "@shared/rest";
import type { ThreadReviewWorkflowInput, ThreadReviewResult } from "@shared/types";
import { queueEnv } from "@shared/env/queue";
import { randomUUID } from "node:crypto";
import type { ThreadReviewInput } from "@shared/rest";

/**
 * Fetch a thread's recent messages + workspace candidate threads for review.
 */
export async function getThreadReviewData(
  input: ThreadReviewWorkflowInput,
): Promise<ThreadReviewInput | null> {
  const thread = await prisma.supportThread.findUnique({
    where: { id: input.threadId },
    select: {
      id: true,
      summary: true,
      issueFingerprint: true,
      status: true,
    },
  });

  if (!thread || thread.status === "CLOSED") return null;

  const messages = await prisma.threadMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      body: true,
      createdAt: true,
    },
  });

  if (messages.length <= 1) return null;

  const candidateThreads = await prisma.supportThread.findMany({
    where: {
      workspaceId: input.workspaceId,
      source: input.source,
      status: { not: "CLOSED" },
      id: { not: input.threadId },
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    take: 15,
    select: {
      id: true,
      summary: true,
      issueFingerprint: true,
    },
  });

  return {
    threadId: thread.id,
    threadSummary: thread.summary,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    candidateThreads,
  };
}

/**
 * Call LLM to review thread messages as a batch.
 */
export async function llmReviewThreadActivity(
  input: ThreadReviewInput,
): Promise<ThreadReviewResult | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[thread-review] LLM_API_KEY not set, skipping review");
    return null;
  }

  return reviewThreadMessages(input, {
    apiKey,
    model: "gpt-4.1",
    timeoutMs: 15000,
  });
}

/**
 * Apply ejections — move messages to target threads (existing or new).
 */
export async function applyThreadEjections(params: {
  workspaceId: string;
  source: string;
  fromThreadId: string;
  ejections: Array<{
    messageId: string;
    reason: string;
    targetThreadId: string | null;
  }>;
}): Promise<number> {
  let applied = 0;

  for (const ejection of params.ejections) {
    try {
      const message = await prisma.threadMessage.findUnique({
        where: { id: ejection.messageId },
      });

      if (!message || message.threadId !== params.fromThreadId) continue;

      let targetThreadId = ejection.targetThreadId;

      // If no target thread, create a new one
      if (!targetThreadId) {
        const newThread = await prisma.supportThread.create({
          data: {
            workspaceId: params.workspaceId,
            customerId: (await prisma.supportThread.findUnique({
              where: { id: params.fromThreadId },
              select: { customerId: true },
            }))!.customerId,
            source: params.source as "DISCORD" | "API",
            externalThreadId: `synthetic-ejected-${randomUUID()}`,
            title: message.body.slice(0, 80),
            status: "WAITING_REVIEW",
            lastMessageAt: message.createdAt,
            lastInboundAt: message.createdAt,
            summary: message.body.slice(0, 180),
            summaryUpdatedAt: message.createdAt,
          },
        });
        targetThreadId = newThread.id;
      }

      // Verify target exists
      const target = await prisma.supportThread.findUnique({
        where: { id: targetThreadId },
      });
      if (!target || target.workspaceId !== params.workspaceId) continue;

      // Move the message
      await prisma.$transaction(async (tx) => {
        await tx.threadMessage.update({
          where: { id: ejection.messageId },
          data: { threadId: targetThreadId },
        });

        // Update timestamps on both threads
        const targetLatest = await tx.threadMessage.findFirst({
          where: { threadId: targetThreadId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        await tx.supportThread.update({
          where: { id: targetThreadId },
          data: { lastMessageAt: targetLatest?.createdAt },
        });

        const fromLatest = await tx.threadMessage.findFirst({
          where: { threadId: params.fromThreadId },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        await tx.supportThread.update({
          where: { id: params.fromThreadId },
          data: { lastMessageAt: fromLatest?.createdAt ?? null },
        });
      });

      applied++;
      console.log(
        `[thread-review] Ejected message ${ejection.messageId} from ${params.fromThreadId} to ${targetThreadId}: ${ejection.reason}`,
      );
    } catch (error) {
      console.error(`[thread-review] Failed to eject message ${ejection.messageId}:`, error);
    }
  }

  // Mark thread as reviewed
  await prisma.supportThread.update({
    where: { id: params.fromThreadId },
    data: { lastReviewedAt: new Date() },
  });

  return applied;
}
