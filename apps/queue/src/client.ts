import { Client, Connection } from "@temporalio/client";
import { temporalConfig } from "./config.js";
import type { TemplateGreetingInput } from "./workflows/template-greeting.workflow.js";
import { workflowRegistry } from "./workflows/registry.js";

async function startTemplateWorkflow(): Promise<void> {
  const connection = await Connection.connect({
    address: temporalConfig.address,
  });

  const client = new Client({
    connection,
    namespace: temporalConfig.namespace,
  });

  const name = process.argv[2] ?? "Template Project";
  const workflowId = `template-greeting-${Date.now()}`;
  const input: TemplateGreetingInput = {
    name,
    requestedRole: "MEMBER",
  };

  const handle = await client.workflow.start(workflowRegistry.templateGreeting, {
    args: [input],
    taskQueue: temporalConfig.taskQueue,
    workflowId,
  });

  console.log(`Started workflow ${handle.workflowId}`);
  const result = await handle.result();
  console.log(`Workflow result: ${result}`);
}

startTemplateWorkflow().catch((error: unknown) => {
  console.error("Failed to start template workflow:", error);
  process.exitCode = 1;
});
