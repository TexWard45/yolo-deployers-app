import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { webEnv } from "@shared/env/web";
import type { ResolveInboxThreadWorkflowInput } from "@shared/types";

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

export async function dispatchResolveInboxThreadWorkflow(
  input: ResolveInboxThreadWorkflowInput,
): Promise<void> {
  const client = await getClient();

  try {
    await client.workflow.start("resolveInboxThreadWorkflow", {
      args: [input],
      taskQueue: webEnv.TEMPORAL_TASK_QUEUE,
      workflowId: `inbox-thread-resolution-${input.workspaceId}-${input.messageId}`,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) return;
    _clientPromise = null;
    throw error;
  }
}
