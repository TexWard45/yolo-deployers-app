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

export async function getThreadAnalysis(threadId: string, workspaceId: string) {
  const session = await getSession();
  if (!session) return null;

  try {
    const trpc = createCaller(createTRPCContext({ sessionUserId: session.id }));
    return await trpc.agent.getLatestAnalysis({
      threadId,
      workspaceId,
      userId: session.id,
    });
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
