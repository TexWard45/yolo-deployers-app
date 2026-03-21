import { prisma } from "@shared/database";

// ── Gate 1: Should we investigate this thread? ─────────────────────

export interface Gate1Input {
  workspaceId: string;
  threadId: string;
}

export interface Gate1Result {
  proceed: boolean;
  reason: string;
}

/**
 * Gate 1 — Should we investigate?
 * Checks: AI enabled, thread open, has inbound messages.
 *
 * PLUGGED IN: reads config + thread status from DB.
 */
export async function evalGate1ShouldInvestigate(
  input: Gate1Input,
): Promise<Gate1Result> {
  const config = await prisma.workspaceAgentConfig.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  if (!config?.enabled) {
    return { proceed: false, reason: "agent_disabled" };
  }

  if (!config.analysisEnabled) {
    return { proceed: false, reason: "analysis_disabled" };
  }

  const thread = await prisma.supportThread.findUnique({
    where: { id: input.threadId },
    select: { status: true, messages: { where: { direction: "INBOUND" }, take: 1 } },
  });

  if (!thread) {
    return { proceed: false, reason: "thread_not_found" };
  }

  if (thread.status === "CLOSED") {
    return { proceed: false, reason: "thread_closed" };
  }

  if (thread.messages.length === 0) {
    return { proceed: false, reason: "no_inbound_messages" };
  }

  return { proceed: true, reason: "ok" };
}

// ── Gate 2: Should we auto-triage to Linear? ───────────────────────

export interface Gate2Input {
  workspaceId: string;
  threadId: string;
  severity: string | null;
  confidence: number;
  issueCategory: string | null;
}

export interface Gate2Result {
  proceed: boolean;
  reason: string;
}

/**
 * Gate 2 — Should we auto-triage?
 * Checks: Linear configured, severity threshold, confidence threshold.
 *
 * PLUGGED IN: checks Linear config exists.
 * TODO: add severity/confidence thresholds, workspace-level auto-triage toggle.
 */
export async function evalGate2ShouldTriage(
  input: Gate2Input,
): Promise<Gate2Result> {
  const config = await prisma.workspaceAgentConfig.findUnique({
    where: { workspaceId: input.workspaceId },
    select: { linearApiKey: true, linearTeamId: true },
  });

  if (!config?.linearApiKey || !config.linearTeamId) {
    return { proceed: false, reason: "linear_not_configured" };
  }

  // TODO: check severity threshold (e.g. only auto-triage high/critical)
  // TODO: check confidence threshold (e.g. only auto-triage if confidence >= 0.8)
  // TODO: check workspace-level autoTriage flag on WorkspaceAgentConfig
  // For now: always proceed if Linear is configured
  return { proceed: true, reason: "linear_configured" };
}

// ── Gate 3: Should we generate an eng spec? ────────────────────────

export interface Gate3Input {
  workspaceId: string;
  threadId: string;
  issueCategory: string | null;
  hasCodexFindings: boolean;
  linearIssueId: string | null;
}

export interface Gate3Result {
  proceed: boolean;
  reason: string;
}

/**
 * Gate 3 — Should we generate a spec?
 * Checks: is it a bug (not how-to), has code findings, ticket exists.
 *
 * PLUGGED IN: basic category check.
 * TODO: add workspace-level autoSpec toggle, check codex findings quality.
 */
export async function evalGate3ShouldSpec(
  input: Gate3Input,
): Promise<Gate3Result> {
  // Skip spec for non-actionable categories
  const skipCategories = ["how_to", "account", "other"];
  if (input.issueCategory && skipCategories.includes(input.issueCategory)) {
    return { proceed: false, reason: `category_${input.issueCategory}_not_actionable` };
  }

  // TODO: check workspace-level autoSpec flag
  // TODO: check if codex findings are high quality enough to generate spec
  // TODO: require Linear ticket to exist before generating spec
  return { proceed: true, reason: "actionable_category" };
}
