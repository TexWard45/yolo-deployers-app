import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";
import { codexConfig, temporalConfig } from "./config.js";

const RESTART_DELAY_MS = 3_000;
let shuttingDown = false;

function resolveWorkflowsPath(): string {
  const runtimePath = fileURLToPath(import.meta.url);
  const runningFromSource = runtimePath.endsWith(".ts");

  if (runningFromSource) {
    const sourcePath = fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
    if (existsSync(sourcePath)) {
      return sourcePath;
    }
  }

  const distPath = fileURLToPath(new URL("./workflows/index.js", import.meta.url));
  if (existsSync(distPath)) {
    return distPath;
  }

  return fileURLToPath(new URL("./workflows/index.ts", import.meta.url));
}

function registerShutdownHooks(): void {
  const onSignal = (signal: NodeJS.Signals) => {
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down Codex worker`);
  };

  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkerOnce(): Promise<void> {
  if (!codexConfig.llm.apiKey) {
    console.warn(
      "Codex worker is running without an LLM API key. Set LLM_API_KEY or OPENAI_API_KEY to enable fix generation.",
    );
  }

  const connection = await NativeConnection.connect({ address: temporalConfig.address });
  try {
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
  } finally {
    await connection.close();
  }
}

async function runWorker(): Promise<void> {
  registerShutdownHooks();

  while (!shuttingDown) {
    try {
      await runWorkerOnce();
      if (!shuttingDown) {
        console.warn(`Codex worker stopped unexpectedly; restarting in ${RESTART_DELAY_MS}ms`);
        await sleep(RESTART_DELAY_MS);
      }
    } catch (error: unknown) {
      if (shuttingDown) break;
      console.error("Codex worker failed:", error);
      console.log(`Retrying Codex worker in ${RESTART_DELAY_MS}ms`);
      await sleep(RESTART_DELAY_MS);
    }
  }
}

runWorker().catch((error: unknown) => {
  console.error("Codex worker terminated:", error);
  process.exitCode = 1;
});
