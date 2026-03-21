import { Client, Connection } from "@temporalio/client";

function getTemporalConfig() {
  return {
    address: process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233",
    namespace: process.env["TEMPORAL_NAMESPACE"] ?? "default",
    taskQueue: process.env["CODEX_TASK_QUEUE"] ?? "codex-sync-queue",
  };
}

async function getTemporalClient(): Promise<Client> {
  const config = getTemporalConfig();
  const connection = await Connection.connect({ address: config.address });
  return new Client({ connection, namespace: config.namespace });
}

function scheduleId(repositoryId: string): string {
  return `codex-cron-${repositoryId}`;
}

/**
 * Create a Temporal Schedule that runs syncRepoWorkflow on the given cron expression.
 */
export async function createCronSchedule(
  repositoryId: string,
  cronExpression: string,
): Promise<void> {
  const client = await getTemporalClient();
  const config = getTemporalConfig();

  await client.schedule.create({
    scheduleId: scheduleId(repositoryId),
    spec: { cronExpressions: [cronExpression] },
    action: {
      type: "startWorkflow",
      workflowType: "syncRepoWorkflow",
      args: [{ repositoryId }],
      taskQueue: config.taskQueue,
    },
  });
}

/**
 * Update an existing schedule's cron expression.
 * Deletes the old schedule and creates a new one since ScheduleSpecDescription
 * doesn't support cronExpressions in the update callback.
 */
export async function updateCronSchedule(
  repositoryId: string,
  cronExpression: string,
): Promise<void> {
  await deleteCronSchedule(repositoryId);
  await createCronSchedule(repositoryId, cronExpression);
}

/**
 * Delete the cron schedule for a repository. No-op if it doesn't exist.
 */
export async function deleteCronSchedule(
  repositoryId: string,
): Promise<void> {
  const client = await getTemporalClient();

  try {
    const handle = client.schedule.getHandle(scheduleId(repositoryId));
    await handle.delete();
  } catch {
    // Schedule doesn't exist — nothing to delete
  }
}
