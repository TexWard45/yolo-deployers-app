/**
 * Test script to trigger sync workflows manually via Temporal Client.
 *
 * Usage:
 *   npx tsx src/client.ts <repositoryId>
 */
import { Client, Connection } from "@temporalio/client";
import { temporalConfig } from "./config.js";
import { codexWorkflowRegistry } from "./workflows/registry.js";
import type { SyncRepoInput, SyncRepoResult } from "./workflows/sync-repo.workflow.js";

async function main(): Promise<void> {
  const repositoryId = process.argv[2];
  if (!repositoryId) {
    console.error("Usage: npx tsx src/client.ts <repositoryId>");
    process.exit(1);
  }

  const connection = await Connection.connect({
    address: temporalConfig.address,
  });

  const client = new Client({
    connection,
    namespace: temporalConfig.namespace,
  });

  const workflowId = `codex-sync-${repositoryId}-${Date.now()}`;

  console.log(`Starting sync workflow for repository: ${repositoryId}`);
  console.log(`Workflow ID: ${workflowId}`);

  const handle = await client.workflow.start<
    (input: SyncRepoInput) => Promise<SyncRepoResult>
  >(codexWorkflowRegistry.syncRepo, {
    args: [{ repositoryId }],
    taskQueue: temporalConfig.taskQueue,
    workflowId,
  });

  console.log("Workflow started. Waiting for result...");

  const result = await handle.result();

  console.log("Sync completed:");
  console.log(`  Commit: ${result.headCommit}`);
  console.log(`  Files processed: ${result.filesProcessed}`);
  console.log(`  Chunks created: ${result.chunksCreated}`);
  console.log(`  Chunks updated: ${result.chunksUpdated}`);
  console.log(`  Chunks deleted: ${result.chunksDeleted}`);
  console.log(`  Sync log ID: ${result.syncLogId}`);
}

main().catch((error: unknown) => {
  console.error("Failed to run sync workflow:", error);
  process.exit(1);
});
