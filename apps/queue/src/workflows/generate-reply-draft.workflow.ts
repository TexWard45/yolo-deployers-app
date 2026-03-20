import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

export interface GenerateReplyDraftWorkflowInput {
  conversationId: string;
}

const { generateReplyDraft } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 seconds",
  retry: { maximumAttempts: 2 },
});

export async function generateReplyDraftWorkflow(
  input: GenerateReplyDraftWorkflowInput
): Promise<{ draftId: string; body: string }> {
  return generateReplyDraft({ conversationId: input.conversationId });
}
