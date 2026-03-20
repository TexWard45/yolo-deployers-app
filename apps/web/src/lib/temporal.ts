import "server-only";
import { Client, Connection } from "@temporalio/client";
import { webEnv } from "@shared/env/web";

let _client: Client | null = null;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  const connection = await Connection.connect({ address: webEnv.TEMPORAL_ADDRESS });
  _client = new Client({ connection, namespace: webEnv.TEMPORAL_NAMESPACE });
  return _client;
}

export async function dispatchSessionEnrichment(sessionId: string): Promise<void> {
  const client = await getClient();
  await client.workflow.start("sessionEnrichmentWorkflow", {
    args: [sessionId],
    taskQueue: webEnv.TEMPORAL_TASK_QUEUE,
    workflowId: `session-enrichment-${sessionId}`,
  });
}
