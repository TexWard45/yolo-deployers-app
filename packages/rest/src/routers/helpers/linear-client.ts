// ── Linear API Client ────────────────────────────────────────────────

import { LinearClient } from "@linear/sdk";

export { LinearClient };

export function createLinearClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}

interface LinearTeamSummary {
  id: string;
  key: string | null;
  name: string | null;
}

function normalizeTeamValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

async function listLinearTeams(client: LinearClient): Promise<LinearTeamSummary[]> {
  const teams = await client.teams();
  return teams.nodes.map((team) => ({
    id: team.id,
    key: team.key ?? null,
    name: team.name ?? null,
  }));
}

export async function resolveLinearTeamId(
  client: LinearClient,
  configuredTeamId: string | null | undefined,
): Promise<string> {
  const teams = await listLinearTeams(client);
  if (teams.length === 0) {
    throw new Error("No Linear teams are available for the configured API key.");
  }

  const normalizedConfigured = normalizeTeamValue(configuredTeamId);
  if (!normalizedConfigured) {
    const firstTeam = teams[0];
    if (!firstTeam) {
      throw new Error("No Linear teams are available for the configured API key.");
    }
    return firstTeam.id;
  }

  const matchingTeam = teams.find((team) => (
    normalizeTeamValue(team.id) === normalizedConfigured
    || normalizeTeamValue(team.key) === normalizedConfigured
    || normalizeTeamValue(team.name) === normalizedConfigured
  ));
  if (matchingTeam) {
    return matchingTeam.id;
  }

  try {
    const byId = await client.team(configuredTeamId as string);
    if (byId?.id) return byId.id;
  } catch {
    // Fall through to a clear actionable error below.
  }

  throw new Error(
    `Linear team '${configuredTeamId}' was not found. Use a valid team id or team key from Linear.`,
  );
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
