import "server-only";
import { Client, Connection } from "@temporalio/client";
import { webEnv } from "@shared/env/web";

let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  try {
    const connection = await Connection.connect({ address: webEnv.TEMPORAL_ADDRESS });
    _client = new Client({ connection, namespace: webEnv.TEMPORAL_NAMESPACE });
    return _client;
  } catch (err) {
    // Don't cache a failed connection — next call will retry
    _client = null;
    throw err;
  }
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
    // If workflow.start fails due to a broken connection, clear cache so next call reconnects
    _client = null;
    throw err;
  }
}
