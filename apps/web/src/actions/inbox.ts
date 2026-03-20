"use server";

import { randomUUID } from "node:crypto";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { getSession } from "@/actions/auth";

export async function createManualInboundMessage(data: {
  workspaceId: string;
  customerName: string;
  messageBody: string;
}) {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "Not authenticated" } as const;
  }

  try {
    const trpc = createCaller(createTRPCContext());
    const externalCustomerId = `manual-customer-${data.customerName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")}`;
    const externalThreadId = `manual-thread-${randomUUID()}`;
    const externalMessageId = `manual-message-${randomUUID()}`;

    const result = await trpc.intake.ingestExternalMessage({
      workspaceId: data.workspaceId,
      userId: session.id,
      source: "MANUAL",
      externalCustomerId,
      externalThreadId,
      customerDisplayName: data.customerName,
      messageBody: data.messageBody,
      externalMessageId,
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
    const trpc = createCaller(createTRPCContext());
    const updated = await trpc.thread.updateStatus({
      threadId: data.threadId,
      userId: session.id,
      status: data.status,
    });
    return { success: true, thread: updated } as const;
  } catch (error) {
    if (error instanceof TRPCError) {
      return { success: false, error: error.message } as const;
    }
    return { success: false, error: "Something went wrong" } as const;
  }
}
