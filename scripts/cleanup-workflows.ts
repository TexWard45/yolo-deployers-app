import { Client, Connection } from "@temporalio/client";

async function main() {
  const connection = await Connection.connect({ address: "localhost:7233" });
  const client = new Client({ connection, namespace: "default" });

  // List all ingest workflows
  const workflows = client.workflow.list({
    query: "WorkflowType = 'ingestSupportMessageWorkflow'",
  });

  let terminated = 0;
  for await (const wf of workflows) {
    console.log(`Found workflow: ${wf.workflowId} — status: ${wf.status.name}`);
    if (wf.status.name === "RUNNING" || wf.status.name === "FAILED") {
      const handle = client.workflow.getHandle(wf.workflowId, wf.runId);
      try {
        await handle.terminate("Cleanup: restarting with new workflow code");
        console.log(`  Terminated: ${wf.workflowId}`);
        terminated++;
      } catch (err) {
        console.log(`  Could not terminate: ${err}`);
      }
    }
  }

  console.log(`\nDone. Terminated ${terminated} workflows.`);
  process.exit(0);
}

main().catch(console.error);
