import { proxyActivities } from "@temporalio/workflow";
import type { WorkspaceRole } from "@shared/types";
import type * as activities from "../activities/index.js";

export interface TemplateGreetingInput {
  name: string;
  requestedRole?: WorkspaceRole;
}

const { formatGreeting } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
});

export async function templateGreetingWorkflow(
  input: TemplateGreetingInput
): Promise<string> {
  const roleSuffix = input.requestedRole ? ` (role: ${input.requestedRole})` : "";
  return formatGreeting(`${input.name}${roleSuffix}`);
}
