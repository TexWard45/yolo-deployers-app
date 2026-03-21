import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { webEnv } from "@shared/env/web";
import type { ThreadReviewWorkflowInput, AnalyzeThreadWorkflowInput } from "@shared/types";

let _clientPromise: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (_clientPromise) return _clientPromise;

  _clientPromise = Connection.connect({ address: webEnv.TEMPORAL_ADDRESS })
    .then((connection) => new Client({ connection, namespace: webEnv.TEMPORAL_NAMESPACE }))
    .catch((error: unknown) => {
      _clientPromise = null;
      throw error;
    });

  return _clientPromise;
}

/**
 * Dispatch the thread review workflow — one per thread.
 * If a workflow is already running/waiting for this thread, skip.
 * The existing workflow will review all messages when its timer expires
 * (it fetches messages at review time, not at dispatch time).
 */
export async function dispatchThreadReviewWorkflow(
  input: ThreadReviewWorkflowInput,
): Promise<void> {
  const client = await getClient();

  try {
    await client.workflow.start("threadReviewWorkflow", {
      args: [input],
      taskQueue: webEnv.TEMPORAL_TASK_QUEUE,
      workflowId: `thread-review-${input.threadId}`,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return;
    _clientPromise = null;
    throw error;
  }
}

/**
 * Dispatch the analyze-thread workflow — one per thread.
 * If a workflow is already running for this thread, skip.
 * The existing workflow's debounce will pick up new messages.
 */
export async function dispatchAnalyzeThreadWorkflow(
  input: AnalyzeThreadWorkflowInput,
): Promise<void> {
  const client = await getClient();

  try {
    await client.workflow.start("analyzeThreadWorkflow", {
      args: [input],
      taskQueue: webEnv.TEMPORAL_TASK_QUEUE,
      workflowId: `analyze-thread-${input.threadId}`,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return;
    _clientPromise = null;
    throw error;
  }
}
