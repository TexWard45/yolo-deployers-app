import "server-only";
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { webEnv } from "@shared/env/web";

// Promise-based singleton: parallel callers share the same in-flight connection
// promise instead of each creating their own Connection object.
let _clientPromise: Promise<Client> | null = null;

function getClient(): Promise<Client> {
  if (_clientPromise) return _clientPromise;
  _clientPromise = Connection.connect({ address: webEnv.TEMPORAL_ADDRESS })
    .then((connection) => new Client({ connection, namespace: webEnv.TEMPORAL_NAMESPACE }))
    .catch((err: unknown) => {
      // Clear the promise on failure so the next call retries
      _clientPromise = null;
      throw err;
    });
  return _clientPromise;
}

export async function dispatchSessionEnrichment(sessionId: string): Promise<void> {
  const client = await getClient();
  try {
    await client.workflow.start("sessionEnrichmentWorkflow", {
      args: [sessionId],
      taskQueue: webEnv.TEMPORAL_TASK_QUEUE,
      workflowId: `session-enrichment-${sessionId}`,
    });
  } catch (err) {
    // Expected: multiple telemetry batches for the same session will race to
    // start the same workflow. The first one wins; later ones are harmless.
    if (err instanceof WorkflowExecutionAlreadyStartedError) return;

    // Genuinely unexpected error — clear client cache so next call reconnects
    _clientPromise = null;
    throw err;
  }
}
