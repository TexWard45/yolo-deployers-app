import { Client, Connection } from "@temporalio/client";
import { temporalConfig } from "./config.js";
import { codexWorkflowRegistry } from "./workflows/registry.js";
import type { SyncRepoInput } from "./workflows/sync-repo.workflow.js";

async function startSyncWorkflow(): Promise<void> {
  const connection = await Connection.connect({
    address: temporalConfig.address,
  });

  const client = new Client({
    connection,
    namespace: temporalConfig.namespace,
  });

  const repositoryId = process.argv[2] ?? "test-repo-id";
  const workflowId = `codex-sync-${repositoryId}-${Date.now()}`;
  const input: SyncRepoInput = { repositoryId };

  const handle = await client.workflow.start(codexWorkflowRegistry.syncRepo, {
    args: [input],
    taskQueue: temporalConfig.taskQueue,
    workflowId,
  });

  console.log(`Started workflow ${handle.workflowId}`);
  const result = await handle.result();
  console.log(`Workflow result: ${result}`);
}

startSyncWorkflow().catch((error: unknown) => {
  console.error("Failed to start codex sync workflow:", error);
  process.exitCode = 1;
});
