import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

export interface SyncRepoInput {
  repositoryId: string;
}

const { ping } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
});

/**
 * Placeholder workflow — will be fully implemented in Phase 3.
 * Current implementation verifies the worker ↔ Temporal connection works.
 */
export async function syncRepoWorkflow(input: SyncRepoInput): Promise<string> {
  const result = await ping(input.repositoryId);
  return result;
}
