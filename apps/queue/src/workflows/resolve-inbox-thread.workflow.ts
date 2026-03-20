import { proxyActivities } from "@temporalio/workflow";
import type {
  ResolveInboxThreadWorkflowInput,
  ResolveInboxThreadWorkflowResult,
} from "@shared/types";
import type * as activities from "../activities/index.js";

const {
  llmThreadMatchActivity,
  getInboxThreadResolutionCandidates,
  applyInboxThreadResolution,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const AUTO_APPLY_THRESHOLD = 0.85;

export async function resolveInboxThreadWorkflow(
  input: ResolveInboxThreadWorkflowInput,
): Promise<ResolveInboxThreadWorkflowResult> {
  const candidates = await getInboxThreadResolutionCandidates(input);

  if (candidates.length === 0) {
    return {
      applied: false,
      matchedThreadId: null,
      confidence: null,
      reason: "no_candidates",
    };
  }

  const llmResult = await llmThreadMatchActivity({
    incomingMessage: input.messageBody,
    threadGroupingHint: input.issueFingerprint,
    candidates,
  });

  if (!llmResult?.matchedThreadId) {
    return {
      applied: false,
      matchedThreadId: null,
      confidence: llmResult?.confidence ?? null,
      reason: llmResult?.reason ?? "no_match",
    };
  }

  if (llmResult.matchedThreadId === input.threadId) {
    return {
      applied: false,
      matchedThreadId: input.threadId,
      confidence: llmResult.confidence,
      reason: "already_on_same_thread",
    };
  }

  if (llmResult.confidence < AUTO_APPLY_THRESHOLD) {
    return {
      applied: false,
      matchedThreadId: llmResult.matchedThreadId,
      confidence: llmResult.confidence,
      reason: "confidence_below_threshold",
    };
  }

  const applied = await applyInboxThreadResolution({
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    fromThreadId: input.threadId,
    toThreadId: llmResult.matchedThreadId,
  });

  return {
    applied,
    matchedThreadId: llmResult.matchedThreadId,
    confidence: llmResult.confidence,
    reason: applied ? "applied" : "apply_failed",
  };
}
