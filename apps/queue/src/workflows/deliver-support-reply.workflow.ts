import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

export interface DeliverSupportReplyInput {
  messageId: string;
  conversationId: string;
}

const { deliverSupportReply, updateMessageDeliveryStatus } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "30 seconds",
    retry: { maximumAttempts: 5, backoffCoefficient: 2 },
  });

export async function deliverSupportReplyWorkflow(
  input: DeliverSupportReplyInput
): Promise<{ success: boolean; externalThreadId: string | null }> {
  const result = await deliverSupportReply({
    messageId: input.messageId,
    conversationId: input.conversationId,
  });

  if (result.success) {
    await updateMessageDeliveryStatus(
      input.messageId,
      "delivered",
      result.externalMessageId
    );
  }

  return {
    success: result.success,
    externalThreadId: result.externalThreadId,
  };
}
