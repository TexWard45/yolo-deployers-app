import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const { processSessionEnrichment } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
});

export async function sessionEnrichmentWorkflow(sessionId: string): Promise<void> {
  await processSessionEnrichment(sessionId);
}
