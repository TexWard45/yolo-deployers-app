import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";
import { temporalConfig } from "./config.js";
import { startDiscordBot } from "./discord-bot.js";
import { seedDiscordConnection } from "./seed-connection.js";

function resolveWorkflowsPath(): string {
  const distPath = fileURLToPath(new URL("./workflows/index.js", import.meta.url));
  if (existsSync(distPath)) {
    return distPath;
  }

  return fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
}

async function runWorker(): Promise<void> {
  // Ensure Discord connection + workspace exist before starting
  await seedDiscordConnection();

  const connection = await NativeConnection.connect({
    address: temporalConfig.address,
  });

  const worker = await Worker.create({
    connection,
    namespace: temporalConfig.namespace,
    taskQueue: temporalConfig.taskQueue,
    workflowsPath: resolveWorkflowsPath(),
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
