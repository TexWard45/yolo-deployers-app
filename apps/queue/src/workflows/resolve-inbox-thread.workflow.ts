import { proxyActivities, sleep } from "@temporalio/workflow";
import type {
  ThreadReviewWorkflowInput,
  ThreadReviewWorkflowResult,
} from "@shared/types";
import type * as activities from "../activities/index.js";

const {
  getThreadReviewData,
  llmReviewThreadActivity,
  applyThreadEjections,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const QUIET_PERIOD_SECONDS = 30; // 30 seconds debounce

/**
 * Thread review workflow — "group first, eject later" pattern.
 *
 * 1. Wait for quiet period (debounce — if new message arrives, this workflow
 *    gets terminated and a new one starts, resetting the timer).
 * 2. Fetch the thread's messages + candidate threads.
 * 3. Call LLM to review the batch.
 * 4. Eject messages that don't belong.
 */
export async function threadReviewWorkflow(
  input: ThreadReviewWorkflowInput,
): Promise<ThreadReviewWorkflowResult> {
  // 1. Wait for quiet period (debounce)
  await sleep(`${QUIET_PERIOD_SECONDS} seconds`);

  // 2. Fetch review data
  const reviewData = await getThreadReviewData(input);

  if (!reviewData) {
    return {
      reviewed: false,
      verdict: "skipped",
      ejectionsApplied: 0,
      reason: "thread_not_found_or_single_message",
    };
  }

  // 3. Call LLM review
  const llmResult = await llmReviewThreadActivity(reviewData);

  if (!llmResult) {
    return {
      reviewed: false,
      verdict: "skipped",
      ejectionsApplied: 0,
      reason: "llm_failed",
    };
  }

  // 4. Apply ejections if needed
  if (llmResult.verdict === "keep_all" || llmResult.ejections.length === 0) {
    return {
      reviewed: true,
      verdict: "keep_all",
      ejectionsApplied: 0,
      reason: "all_messages_belong_together",
    };
  }

  const applied = await applyThreadEjections({
    workspaceId: input.workspaceId,
    source: input.source,
    fromThreadId: input.threadId,
    ejections: llmResult.ejections,
  });

  return {
    reviewed: true,
    verdict: "eject",
    ejectionsApplied: applied,
    reason: `ejected ${applied} message(s)`,
  };
}
