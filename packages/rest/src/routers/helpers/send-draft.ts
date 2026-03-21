import type { PrismaClient } from "@shared/types/prisma";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface SendDraftInput {
  draftId: string;
  draftBody: string;
  threadId: string;
  threadSource: string;
  externalThreadId: string;
  firstInbound: {
    metadata: unknown;
    externalMessageId: string | null;
    body: string | null;
  } | null;
  /** "ai-draft-approved" for human-approved, "ai-auto-reply" for auto mode */
  metadataSource: string;
}

interface SendDraftResult {
  externalMessageId: string | null;
}

/**
 * Sends a draft reply to the customer's channel (Discord) and records
 * the outbound message + updates thread/draft status.
 *
 * Shared by `approveDraft` (human click) and `saveAnalysis` (auto-reply).
 */
export async function sendDraftToChannel(
  prisma: PrismaClient,
  input: SendDraftInput,
): Promise<SendDraftResult> {
  let externalMessageId: string | null = null;

  if (input.threadSource === "DISCORD") {
    externalMessageId = await sendToDiscord(prisma, input);
  }

  // Record outbound message
  await prisma.threadMessage.create({
    data: {
      threadId: input.threadId,
      direction: "OUTBOUND",
      body: input.draftBody,
      externalMessageId,
      metadata: { source: input.metadataSource, draftId: input.draftId },
    },
  });

  // Update thread status + timestamps
  const now = new Date();
  await prisma.supportThread.update({
    where: { id: input.threadId },
    data: {
      lastMessageAt: now,
      lastOutboundAt: now,
      status: "WAITING_CUSTOMER",
    },
  });

  // Mark draft as SENT
  await prisma.replyDraft.update({
    where: { id: input.draftId },
    data: { status: "SENT" },
  });

  return { externalMessageId };
}

async function sendToDiscord(
  prisma: PrismaClient,
  input: SendDraftInput,
): Promise<string | null> {
  const firstInbound = input.firstInbound;
  const meta = firstInbound?.metadata as Record<string, unknown> | null;
  const channelId = (meta?.channelId as string)
    ?? ((meta?.rawPayload as Record<string, unknown> | null)?.channelId as string)
    ?? null;
  const isSynthetic = input.externalThreadId.startsWith("synthetic-");

  console.log("[sendDraft] channelId:", channelId, "isSynthetic:", isSynthetic);

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error("[sendDraft] DISCORD_BOT_TOKEN not set in env");
    return null;
  }

  if (isSynthetic && channelId && firstInbound?.externalMessageId) {
    return sendViaSyntheticThread(prisma, input, botToken, channelId, firstInbound.externalMessageId, firstInbound.body);
  }

  if (!isSynthetic) {
    return sendToExistingThread(input, botToken);
  }

  console.error("[sendDraft] cannot resolve Discord target — channelId:", channelId);
  return null;
}

async function sendViaSyntheticThread(
  prisma: PrismaClient,
  input: SendDraftInput,
  botToken: string,
  channelId: string,
  firstMessageId: string,
  firstMessageBody: string | null,
): Promise<string | null> {
  try {
    const threadName = (firstMessageBody ?? "Support").slice(0, 100);

    // Create thread from customer's first message
    const threadRes = await fetch(
      `${DISCORD_API_BASE}/channels/${channelId}/messages/${firstMessageId}/threads`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: threadName, auto_archive_duration: 1440 }),
      },
    );

    let threadChannelId: string | null = null;

    if (threadRes.ok) {
      const data = (await threadRes.json()) as { id: string };
      threadChannelId = data.id;
      console.log(`[sendDraft] created Discord thread ${threadChannelId}`);
    } else {
      const errText = await threadRes.text().catch(() => "");
      console.error(`[sendDraft] create thread failed (${threadRes.status}): ${errText}`);
      if (threadRes.status === 400) {
        threadChannelId = channelId;
      }
    }

    if (!threadChannelId) return null;

    // Send reply inside the thread
    const msgRes = await fetch(
      `${DISCORD_API_BASE}/channels/${threadChannelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: input.draftBody }),
      },
    );

    if (msgRes.ok) {
      const msgData = (await msgRes.json()) as { id: string };
      console.log(`[sendDraft] sent message ${msgData.id} in thread ${threadChannelId}`);

      // Update SupportThread with real Discord thread ID
      if (threadChannelId !== channelId) {
        await prisma.supportThread.update({
          where: { id: input.threadId },
          data: { externalThreadId: threadChannelId },
        });
      }
      return msgData.id;
    }

    const error = await msgRes.text().catch(() => "");
    console.error(`[sendDraft] Discord send error (${msgRes.status}): ${error}`);
    return null;
  } catch (error) {
    console.error("[sendDraft] Discord thread+send failed:", error);
    return null;
  }
}

async function sendToExistingThread(
  input: SendDraftInput,
  botToken: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/channels/${input.externalThreadId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: input.draftBody }),
      },
    );

    if (response.ok) {
      const data = (await response.json()) as { id: string };
      console.log(`[sendDraft] sent message ${data.id} in existing thread ${input.externalThreadId}`);
      return data.id;
    }

    const error = await response.text().catch(() => "");
    console.error(`[sendDraft] Discord API error (${response.status}): ${error}`);
    return null;
  } catch (error) {
    console.error("[sendDraft] Discord send failed:", error);
    return null;
  }
}
