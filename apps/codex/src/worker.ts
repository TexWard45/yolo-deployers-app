import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";
import { temporalConfig } from "./config.js";

function resolveWorkflowsPath(): string {
  const distPath = fileURLToPath(new URL("./workflows/index.js", import.meta.url));
  if (existsSync(distPath)) {
    return distPath;
  }

  return fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
}

async function runWorker(): Promise<void> {
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
    `Codex worker listening on ${temporalConfig.address} (namespace=${temporalConfig.namespace}, taskQueue=${temporalConfig.taskQueue})`
  );

  await worker.run();
}

runWorker().catch((error: unknown) => {
  console.error("Codex worker failed:", error);
  process.exitCode = 1;
});
