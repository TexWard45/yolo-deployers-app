// ── Linear API Client ────────────────────────────────────────────────

import { LinearClient } from "@linear/sdk";

export { LinearClient };

export function createLinearClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

const SEVERITY_TO_PRIORITY: Record<string, number> = {
  urgent: 1,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  none: 0,
};

export function severityToPriority(severity: string | null | undefined): number {
  if (!severity) return 0;
  return SEVERITY_TO_PRIORITY[severity.toLowerCase()] ?? 0;
}

export interface CreateLinearIssueInput {
  teamId: string;
  title: string;
  description: string;
  priority?: number;
  labelNames?: string[];
}

export interface LinearIssueResult {
  id: string;
  identifier: string;
  url: string;
}

export async function createLinearIssue(
  client: LinearClient,
  input: CreateLinearIssueInput,
): Promise<LinearIssueResult> {
  // Resolve label IDs from names
  let labelIds: string[] | undefined;
  if (input.labelNames && input.labelNames.length > 0) {
    const labels = await client.issueLabels({
      filter: { name: { in: input.labelNames } },
    });
    labelIds = labels.nodes.map((l) => l.id);
  }

  const result = await client.createIssue({
    teamId: input.teamId,
    title: input.title,
    description: input.description,
    priority: input.priority ?? 0,
    labelIds,
  });

  const issue = await result.issue;
  if (!issue) {
    throw new Error("Failed to create Linear issue — no issue returned");
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
  };
}

export interface UpdateLinearIssueInput {
  title?: string;
  description?: string;
  priority?: number;
}

export async function updateLinearIssue(
  client: LinearClient,
  issueId: string,
  input: UpdateLinearIssueInput,
): Promise<LinearIssueResult> {
  const result = await client.updateIssue(issueId, input);
  const issue = await result.issue;
  if (!issue) {
    throw new Error("Failed to update Linear issue — no issue returned");
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
  };
}

export async function getLinearIssue(
  client: LinearClient,
  issueId: string,
): Promise<LinearIssueResult | null> {
  try {
    const issue = await client.issue(issueId);
    return {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
    };
  } catch {
    return null;
  }
}
