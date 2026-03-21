"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { getSession } from "@/actions/auth";

export async function createManualInboundMessage(data: {
  workspaceId: string;
  customerName: string;
  customerExternalId?: string;
  messageBody: string;
  threadGroupingHint?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const normalizedCustomerName = data.customerName.trim().toLowerCase().replace(/\s+/g, "-");
    const externalCustomerId = data.customerExternalId?.trim().length
      ? data.customerExternalId.trim()
      : `manual-customer-${normalizedCustomerName}`;
    const externalMessageId = `manual-message-${randomUUID()}`;

    const result = await trpc.intake.ingestExternalMessage({
      workspaceId: data.workspaceId,
      source: "MANUAL",
      externalCustomerId,
      customerDisplayName: data.customerName,
      messageBody: data.messageBody,
      externalMessageId,
      threadGroupingHint: data.threadGroupingHint?.trim() || undefined,
      metadata: { source: "manual-ui-intake" },
    });

    return { success: true, threadId: result.thread.id } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function getThreadDetail(threadId: string): Promise<Awaited<
  ReturnType<ReturnType<typeof createCaller>["thread"]["getById"]>
> | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    return await trpc.thread.getById({ threadId });
  } catch {
    return null;
  }
}

export async function sendReply(data: {
  threadId: string;
  body: string;
  inReplyToExternalMessageId?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.message.createOutgoingDraft({
      threadId: data.threadId,
      body: data.body,
      inReplyToExternalMessageId: data.inReplyToExternalMessageId,
    });
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function getThreadAnalysis(threadId: string, workspaceId: string): Promise<Record<string, unknown> | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const result = await trpc.agent.getLatestAnalysis({
      threadId,
      workspaceId,
      userId: session.id,
    });
    return result as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export async function triggerThreadAnalysis(threadId: string, workspaceId: string) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.agent.triggerAnalysis({
      threadId,
      workspaceId,
      userId: session.id,
    });
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function approveDraftAction(data: {
  draftId: string;
  workspaceId: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    console.log("[approveDraftAction] calling tRPC approveDraft", { draftId: data.draftId, workspaceId: data.workspaceId });
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const result = await trpc.agent.approveDraft({
      draftId: data.draftId,
      workspaceId: data.workspaceId,
      userId: session.id,
    });
    console.log("[approveDraftAction] success, draft status:", result.status);
    return { success: true } as const;
  } catch (error) {
    const message = error instanceof TRPCError ? error.message : String(error);
    console.error("[approveDraftAction] FAILED:", message, error);
    return { success: false, error: message } as const;
  }
}

export async function dismissDraftAction(data: {
  draftId: string;
  workspaceId: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    await trpc.agent.dismissDraft({
      draftId: data.draftId,
      workspaceId: data.workspaceId,
      userId: session.id,
    });
    return { success: true } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}

export async function triageToLinearAction(data: {
  threadId: string;
  workspaceId: string;
  analysisId: string;
  overrides?: {
    title?: string;
    description?: string;
    severity?: "urgent" | "high" | "medium" | "low" | "none";
    labels?: string[];
  };
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const result = await trpc.agent.triageToLinear({
      threadId: data.threadId,
      workspaceId: data.workspaceId,
      userId: session.id,
      analysisId: data.analysisId,
      overrides: data.overrides,
    });
    return { success: true, ...result } as const;
  } catch (error) {
    const message = error instanceof TRPCError ? error.message : String(error);
    return { success: false, error: message } as const;
  }
}

export async function getTriageStatusAction(threadId: string, workspaceId: string) {
  const session = await getSession();
  if (!session) return null;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    return await trpc.agent.getTriageStatus({
      threadId,
      workspaceId,
      userId: session.id,
    });
  } catch {
    return null;
  }
}

export async function generateSpecAction(data: {
  threadId: string;
  workspaceId: string;
  linearIssueId?: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const result = await trpc.agent.generateSpec({
      threadId: data.threadId,
      workspaceId: data.workspaceId,
      userId: session.id,
      linearIssueId: data.linearIssueId,
    });
    return { success: true, ...result } as const;
  } catch (error) {
    const message = error instanceof TRPCError ? error.message : String(error);
    return { success: false, error: message } as const;
  }
}

export async function generateFixPRAction(data: {
  threadId: string;
  workspaceId: string;
  analysisId: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const result = await trpc.agent.generateFixPR({
      threadId: data.threadId,
      workspaceId: data.workspaceId,
      analysisId: data.analysisId,
      userId: session.id,
    });
    return { success: true, ...result } as const;
  } catch (error) {
    const message = error instanceof TRPCError ? error.message : String(error);
    return { success: false, error: message } as const;
  }
}

export interface FixPRIterationStatusResult {
  id: string;
  iteration: number;
  status: string;
  fixPlan: unknown;
  reviewFindings: unknown;
  checkResults: unknown;
  appliedFiles: unknown;
  startedAt: string;
  completedAt: string | null;
}

export interface FixPRStatusResult {
  runId: string;
  status: string;
  currentStage: string;
  parentThreadId: string | null;
  iterationCount: number;
  maxIterations: number;
  summary: string | null;
  lastError: string | null;
  prUrl: string | null;
  prNumber: number | null;
  branchName: string | null;
  rcaSummary: string | null;
  rcaConfidence: number | null;
  iterations: FixPRIterationStatusResult[];
}

export async function getFixPRStatusAction(
  threadId: string,
  workspaceId: string,
): Promise<FixPRStatusResult | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    return await trpc.agent.getFixPRStatus({
      threadId,
      workspaceId,
      userId: session.id,
    });
  } catch {
    return null;
  }
}

export async function cancelFixPRAction(data: {
  runId: string;
  workspaceId: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const result = await trpc.agent.cancelFixPR({
      runId: data.runId,
      workspaceId: data.workspaceId,
      userId: session.id,
    });
    return { success: true, ...result } as const;
  } catch (error) {
    const message = error instanceof TRPCError ? error.message : String(error);
    return { success: false, error: message } as const;
  }
}

export async function updateThreadStatusAction(data: {
  threadId: string;
  status:
    | "NEW"
    | "WAITING_REVIEW"
    | "WAITING_CUSTOMER"
    | "ESCALATED"
    | "IN_PROGRESS"
    | "CLOSED";
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    const updated = await trpc.thread.updateStatus({
      threadId: data.threadId,
      status: data.status,
    });
    revalidatePath("/inbox");
    return { success: true, thread: updated } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
