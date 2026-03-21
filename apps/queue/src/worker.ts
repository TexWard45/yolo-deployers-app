import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";
import { temporalConfig } from "./config.js";
import { startDiscordBot } from "./discord-bot.js";
import { seedDiscordConnection } from "./seed-connection.js";
import { workflowRegistry } from "./workflows/registry.js";

function resolveWorkflowsPath(): string {
  const distPath = fileURLToPath(new URL("./workflows/index.js", import.meta.url));
  if (existsSync(distPath)) {
    return distPath;
  }

  return fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
}

async function runWorker(): Promise<void> {
  const workerFile = fileURLToPath(new URL("./worker.ts", import.meta.url));
  const workflowFile = fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
  const activityFile = fileURLToPath(new URL("./activities/index.ts", import.meta.url));
  const resolvedWorkflowsPath = resolveWorkflowsPath();
  const activityKeys = Object.keys(activities).sort();

  const requiredActivities = ["getThreadReviewData", "saveTriageResultActivity"];
  const missingRequired = requiredActivities.filter((name) => !activityKeys.includes(name));

  console.log(`[queue-worker] bootstrap metadata`, {
    cwd: process.cwd(),
    workerFile,
    workflowFile,
    activityFile,
    resolvedWorkflowsPath,
    temporalTaskQueue: temporalConfig.taskQueue,
    activitiesCount: activityKeys.length,
  });
  console.log(`[queue-worker] registered activities:`, activityKeys);
  console.log(`[queue-worker] registered workflows:`, workflowRegistry);

  if (missingRequired.length > 0) {
    throw new Error(
      `[queue-worker] Missing required activities: ${missingRequired.join(", ")}. ` +
        "This usually means an outdated worker bundle is running.",
    );
  }

  // Ensure Discord connection + workspace exist before starting
  await seedDiscordConnection();

  const connection = await NativeConnection.connect({
    address: temporalConfig.address,
  });

  const worker = await Worker.create({
    connection,
    namespace: temporalConfig.namespace,
    taskQueue: temporalConfig.taskQueue,
    workflowsPath: resolvedWorkflowsPath,
    activities,
  });
  console.log(
    `Queue worker listening on ${temporalConfig.address} (namespace=${temporalConfig.namespace}, taskQueue=${temporalConfig.taskQueue})`
  );

  // Start Discord bot if token is configured
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  if (discordToken) {
    startDiscordBot(discordToken);
  }

  await worker.run();
}

runWorker().catch((error: unknown) => {
  console.error("Queue worker failed:", error);
  process.exitCode = 1;
});
