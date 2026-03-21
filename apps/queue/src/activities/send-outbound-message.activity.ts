import { prisma } from "@shared/database";
import { queueEnv } from "@shared/env/queue";

const DISCORD_API_BASE = "https://discord.com/api/v10";

// ── Types ───────────────────────────────────────────────────────────

export interface SendOutboundMessageInput {
  draftId: string;
  threadId: string;
  workspaceId: string;
}

interface OutboundContext {
  draftBody: string;
  source: string;
  externalThreadId: string;
  // Discord-specific routing from the first inbound message's rawPayload
  channelId: string | null;
  guildId: string | null;
}

// ── Activity 1: Fetch outbound context ──────────────────────────────

export async function getOutboundContext(
  input: SendOutboundMessageInput,
): Promise<OutboundContext | null> {
  const draft = await prisma.replyDraft.findUnique({
    where: { id: input.draftId },
    select: { body: true, status: true },
  });

  if (!draft || draft.status !== "APPROVED") {
    console.warn(`[send-outbound] draft ${input.draftId} not found or not APPROVED`);
    return null;
  }

  const thread = await prisma.supportThread.findUnique({
    where: { id: input.threadId },
    select: {
      source: true,
      externalThreadId: true,
      messages: {
        where: { direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { metadata: true },
      },
    },
  });

  if (!thread) {
    console.warn(`[send-outbound] thread ${input.threadId} not found`);
    return null;
  }

  // Extract Discord channelId from the most recent inbound message's rawPayload
  const lastInbound = thread.messages[0];
  const rawPayload = (lastInbound?.metadata as Record<string, unknown> | null)?.rawPayload as Record<string, unknown> | null;
  const channelId = (rawPayload?.channelId as string) ?? null;
  const guildId = (rawPayload?.guildId as string) ?? null;

  return {
    draftBody: draft.body,
    source: thread.source,
    externalThreadId: thread.externalThreadId,
    channelId,
    guildId,
  };
}

// ── Activity 2: Send message to Discord ─────────────────────────────

export async function sendToDiscordActivity(params: {
  body: string;
  externalThreadId: string;
  channelId: string | null;
}): Promise<{ externalMessageId: string } | null> {
  const botToken = queueEnv.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error("[send-outbound] DISCORD_BOT_TOKEN not set");
    return null;
  }

  // Determine the target channel:
  // - If externalThreadId looks like a Discord snowflake, it IS the thread channel
  // - Otherwise fall back to channelId from the inbound message's metadata
  const targetChannelId = params.externalThreadId.startsWith("synthetic-")
    ? params.channelId
    : params.externalThreadId;

  if (!targetChannelId) {
    console.error("[send-outbound] no target channel ID available");
    return null;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${targetChannelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: params.body }),
      },
    );

    if (!response.ok) {
      const error = await response.text().catch(() => "");
      console.error(`[send-outbound] Discord API error (${response.status}): ${error}`);
      return null;
    }

    const data = (await response.json()) as { id: string };
    console.log(`[send-outbound] sent message ${data.id} to channel ${targetChannelId}`);
    return { externalMessageId: data.id };
  } catch (error) {
    console.error("[send-outbound] Discord send failed:", error);
    return null;
  }
}

// ── Activity 3: Record outbound message + mark draft SENT ───────────

export async function recordOutboundMessageActivity(params: {
  draftId: string;
  threadId: string;
  body: string;
  externalMessageId: string | null;
}): Promise<void> {
  // Create OUTBOUND ThreadMessage
  await prisma.threadMessage.create({
    data: {
      threadId: params.threadId,
      direction: "OUTBOUND",
      body: params.body,
      externalMessageId: params.externalMessageId,
      metadata: {
        source: "ai-draft-approved",
        draftId: params.draftId,
      },
    },
  });

  // Update thread timestamps
  const now = new Date();
  await prisma.supportThread.update({
    where: { id: params.threadId },
    data: {
      lastMessageAt: now,
      lastOutboundAt: now,
      status: "WAITING_CUSTOMER",
    },
  });

  // Mark draft as SENT
  await prisma.replyDraft.update({
    where: { id: params.draftId },
    data: { status: "SENT" },
  });

  console.log(`[send-outbound] recorded outbound message for draft ${params.draftId}`);
}
