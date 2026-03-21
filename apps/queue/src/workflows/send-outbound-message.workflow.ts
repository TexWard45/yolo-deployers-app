import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const {
  getOutboundContext,
  sendToDiscordActivity,
  recordOutboundMessageActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 seconds",
  retry: { maximumAttempts: 3 },
});

export interface SendOutboundMessageWorkflowInput {
  draftId: string;
  threadId: string;
  workspaceId: string;
}

/**
 * Sends an approved draft reply to the customer's channel (Discord thread, etc.)
 * and records it as an OUTBOUND message.
 */
export async function sendOutboundMessageWorkflow(
  input: SendOutboundMessageWorkflowInput,
): Promise<{ sent: boolean; reason: string }> {
  // 1. Fetch context (draft body, thread source, Discord channel info)
  const context = await getOutboundContext(input);
  if (!context) {
    return { sent: false, reason: "context_not_found" };
  }

  // 2. Send to the external channel
  let externalMessageId: string | null = null;

  if (context.source === "DISCORD") {
    const result = await sendToDiscordActivity({
      body: context.draftBody,
      externalThreadId: context.externalThreadId,
      channelId: context.channelId,
    });
    if (!result) {
      return { sent: false, reason: "discord_send_failed" };
    }
    externalMessageId = result.externalMessageId;
  } else {
    // For non-Discord sources (API, MANUAL): just record the message, no external send
    console.log(`[send-outbound] source=${context.source}, skipping external send`);
  }

  // 3. Record outbound message + mark draft SENT
  await recordOutboundMessageActivity({
    draftId: input.draftId,
    threadId: input.threadId,
    body: context.draftBody,
    externalMessageId,
  });

  return { sent: true, reason: "ok" };
}
