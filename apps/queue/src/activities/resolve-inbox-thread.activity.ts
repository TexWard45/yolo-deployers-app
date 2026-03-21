import { prisma } from "@shared/database";
import type { ResolveInboxThreadWorkflowInput } from "@shared/types";

interface InboxThreadResolutionCandidate {
  id: string;
  issueFingerprint: string | null;
  summary: string | null;
}

export async function getInboxThreadResolutionCandidates(
  input: ResolveInboxThreadWorkflowInput,
): Promise<InboxThreadResolutionCandidate[]> {
  // Workspace-wide candidates (not per-customer) so cross-user same-issue matching works
  const candidates = await prisma.supportThread.findMany({
    where: {
      workspaceId: input.workspaceId,
      source: input.source,
      status: { not: "CLOSED" },
      id: { not: input.threadId },
    },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 20,
    select: {
      id: true,
      issueFingerprint: true,
      summary: true,
    },
  });

  return candidates;
}

export async function applyInboxThreadResolution(params: {
  workspaceId: string;
  messageId: string;
  fromThreadId: string;
  toThreadId: string;
}): Promise<boolean> {
  if (params.fromThreadId === params.toThreadId) return false;

  const message = await prisma.threadMessage.findUnique({
    where: { id: params.messageId },
    include: {
      thread: true,
    },
  });

  if (!message) return false;
  if (message.thread.workspaceId !== params.workspaceId) return false;
  if (message.threadId !== params.fromThreadId) return false;

  const targetThread = await prisma.supportThread.findUnique({
    where: { id: params.toThreadId },
  });
  if (!targetThread || targetThread.workspaceId !== params.workspaceId) return false;

  await prisma.$transaction(async (tx) => {
    await tx.threadMessage.update({
      where: { id: params.messageId },
      data: { threadId: params.toThreadId },
    });

    const targetLatest = await tx.threadMessage.findFirst({
      where: { threadId: params.toThreadId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const fromLatest = await tx.threadMessage.findFirst({
      where: { threadId: params.fromThreadId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    await tx.supportThread.update({
      where: { id: params.toThreadId },
      data: {
        lastMessageAt: targetLatest?.createdAt ?? targetThread.lastMessageAt,
      },
    });

    await tx.supportThread.update({
      where: { id: params.fromThreadId },
      data: {
        lastMessageAt: fromLatest?.createdAt ?? null,
      },
    });
  });

  return true;
}
