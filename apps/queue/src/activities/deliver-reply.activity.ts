// @ts-nocheck — references schema models not yet migrated
import { prisma } from "@shared/database";

export interface DeliverReplyInput {
  messageId: string;
  conversationId: string;
}

export interface DeliverReplyResult {
  success: boolean;
  externalMessageId: string | null;
  externalThreadId: string | null;
  error: string | null;
}

export async function deliverSupportReply(input: DeliverReplyInput): Promise<DeliverReplyResult> {
  const message = await prisma.conversationMessage.findUnique({
    where: { id: input.messageId },
  });

  if (!message) {
    throw new Error(`Message not found: ${input.messageId}`);
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    include: {
      messages: {
        where: { direction: "INBOUND" },
        orderBy: { sentAt: "asc" },
        take: 1,
      },
    },
  });

  if (!conversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`);
  }

  try {
    if (conversation.primaryChannelType === "DISCORD") {
      return await deliverToDiscord(message.body, conversation);
    } else if (conversation.primaryChannelType === "IN_APP") {
      return await deliverToInAppChat(message.body, conversation);
    }

    throw new Error(`Unsupported channel type: ${conversation.primaryChannelType}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown delivery error";

    await prisma.conversationMessage.update({
      where: { id: input.messageId },
      data: { deliveryStatus: "failed" },
    });

    return {
      success: false,
      externalMessageId: null,
      externalThreadId: null,
      error: errorMessage,
    };
  }
}

async function deliverToDiscord(
  _body: string,
  conversation: {
    id: string;
    externalThreadId: string | null;
    messages: Array<{ externalMessageId: string | null; channelConnectionId: string | null }>;
  }
): Promise<DeliverReplyResult> {
  // Thread-first delivery:
  // 1. If externalThreadId exists, post into that thread
  // 2. If not, create a thread on the original inbound message

  const firstInbound = conversation.messages[0];

  // TODO: Replace with actual Discord API calls using DISCORD_BOT_TOKEN
  // For now, simulate the delivery

  let threadId = conversation.externalThreadId;

  if (!threadId && firstInbound?.externalMessageId) {
    // Create a new thread on the original message
    // Discord API: POST /channels/{channel_id}/messages/{message_id}/threads
    // For now, simulate thread creation
    threadId = `thread-${conversation.id}-${Date.now()}`;

    // Persist the thread ID back to the conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { externalThreadId: threadId },
    });
  }

  // Post the reply into the thread (or channel if no thread possible)
  // Discord API: POST /channels/{threadId}/messages
  const externalMessageId = `discord-msg-${Date.now()}`;

  // Mark as delivered
  // In production, this would be after the Discord API confirms success

  return {
    success: true,
    externalMessageId,
    externalThreadId: threadId,
    error: null,
  };
}

async function deliverToInAppChat(
  _body: string,
  conversation: {
    id: string;
    externalThreadId: string | null;
  }
): Promise<DeliverReplyResult> {
  // In-app chat: reply goes into the existing session
  // The externalThreadId is the sessionId for in-app chat
  // The client polls or subscribes for new messages

  const externalMessageId = `inapp-msg-${Date.now()}`;

  return {
    success: true,
    externalMessageId,
    externalThreadId: conversation.externalThreadId,
    error: null,
  };
}

export async function updateMessageDeliveryStatus(
  messageId: string,
  status: string,
  externalMessageId: string | null
): Promise<void> {
  await prisma.conversationMessage.update({
    where: { id: messageId },
    data: {
      deliveryStatus: status,
      externalMessageId,
    },
  });
}
