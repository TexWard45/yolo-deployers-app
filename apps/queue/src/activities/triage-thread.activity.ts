import { prisma } from "@shared/database";
import {
  fetchSentryContext,
  generateLinearIssueBody,
  generateEngSpec,
  createLinearClient,
  createLinearIssue,
  updateLinearIssue,
  getLinearIssue,
  severityToPriority,
} from "@shared/rest";
import type { SentryConfig, TriagePromptInput } from "@shared/rest";
import type { TriageThreadWorkflowInput } from "@shared/types";
import { queueEnv } from "@shared/env/queue";

// ── Types ──────────────────────────────────────────────────────────

export interface TriageContext {
  threadId: string;
  workspaceId: string;
  analysisId: string;
  triggeredByUserId: string;
  // Thread data
  threadTitle: string | null;
  linearIssueId: string | null;
  linearIssueUrl: string | null;
  // Analysis data
  analysis: {
    issueCategory: string | null;
    severity: string | null;
    affectedComponent: string | null;
    summary: string;
    rcaSummary: string | null;
    codexFindings: unknown | null;
    sentryFindings: unknown | null;
  };
  // Messages for LLM context
  messages: Array<{ direction: string; body: string }>;
  customerDisplayName: string;
  // Config
  codexRepositoryIds: string[];
  sentryConfig: SentryConfig | null;
  linearConfig: {
    apiKey: string;
    teamId: string;
    defaultLabels: string[];
  } | null;
  agentModel: string | null;
}

// ── Activity 1: Get triage context ─────────────────────────────────

export async function getTriageContext(
  input: TriageThreadWorkflowInput,
): Promise<TriageContext | null> {
  const analysis = await prisma.threadAnalysis.findUnique({
    where: { id: input.analysisId },
    include: {
      thread: {
        include: {
          customer: true,
          messages: { orderBy: { createdAt: "asc" }, take: 20 },
        },
      },
    },
  });

  if (!analysis || analysis.workspaceId !== input.workspaceId) {
    console.log("[triage] analysis not found or workspace mismatch, skipping");
    return null;
  }

  const config = await prisma.workspaceAgentConfig.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  const sentryConfig: SentryConfig | null =
    config?.sentryOrgSlug && (config.sentryProjectSlug || (config.sentryProjectSlugs && config.sentryProjectSlugs.length > 0)) && config.sentryAuthToken
      ? {
          orgSlug: config.sentryOrgSlug,
          projectSlug: config.sentryProjectSlug ?? config.sentryProjectSlugs[0]!,
          authToken: config.sentryAuthToken,
          projectSlugs: config.sentryProjectSlugs.length > 0 ? config.sentryProjectSlugs : undefined,
        }
      : null;

  const linearConfig =
    config?.linearApiKey && config.linearTeamId
      ? {
          apiKey: config.linearApiKey,
          teamId: config.linearTeamId,
          defaultLabels: config.linearDefaultLabels,
        }
      : null;

  return {
    threadId: analysis.threadId,
    workspaceId: input.workspaceId,
    analysisId: input.analysisId,
    triggeredByUserId: input.triggeredByUserId,
    threadTitle: analysis.thread.title,
    linearIssueId: analysis.thread.linearIssueId,
    linearIssueUrl: analysis.thread.linearIssueUrl,
    analysis: {
      issueCategory: analysis.issueCategory,
      severity: analysis.severity,
      affectedComponent: analysis.affectedComponent,
      summary: analysis.summary,
      rcaSummary: analysis.rcaSummary,
      codexFindings: analysis.codexFindings,
      sentryFindings: analysis.sentryFindings,
    },
    messages: analysis.thread.messages.map((m) => ({
      direction: m.direction,
      body: m.body,
    })),
    customerDisplayName: analysis.thread.customer.displayName,
    codexRepositoryIds: config?.codexRepositoryIds ?? [],
    sentryConfig,
    linearConfig,
    agentModel: config?.model ?? null,
  };
}

// ── Activity 2: Search codebase (re-search with triage focus) ──────

export async function triageSearchCodebaseActivity(params: {
  workspaceId: string;
  codexRepositoryIds: string[];
  analysisQuery: string;
}): Promise<unknown | null> {
  if (params.codexRepositoryIds.length === 0) return null;

  const agentGrepUrl = `${queueEnv.WEB_APP_URL}/api/rest/codex/agent/grep`;

  try {
    // Call agent-grep for each repository in parallel
    const results = await Promise.all(
      params.codexRepositoryIds.map(async (repositoryId) => {
        const response = await fetch(agentGrepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: params.workspaceId,
            repositoryId,
            taskDescription: params.analysisQuery,
            maxResults: 5,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          console.warn(`[triage] agent-grep failed for repo ${repositoryId} (${response.status})`);
          return null;
        }

        return (await response.json()) as { chunks?: Array<{ id: string; score: number; filePath: string; content: string; symbolName: string | null; chunkType: string }> };
      }),
    );

    // Merge chunks from all repos, deduplicate by chunk ID, keep top 5 by score
    type GrepChunk = { id: string; score: number; filePath: string; content: string; symbolName: string | null; chunkType: string };
    const chunkMap = new Map<string, GrepChunk>();
    for (const result of results) {
      if (!result?.chunks || !Array.isArray(result.chunks)) continue;
      for (const chunk of result.chunks) {
        const existing = chunkMap.get(chunk.id);
        if (!existing || chunk.score > existing.score) {
          chunkMap.set(chunk.id, chunk);
        }
      }
    }

    const mergedChunks = [...chunkMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { chunks: mergedChunks };
  } catch (error) {
    console.warn("[triage] agent-grep error, falling back to direct search:", error);

    // Fallback to old /codex/search
    const url = `${queueEnv.WEB_APP_URL}/api/rest/codex/search`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: params.workspaceId,
          query: params.analysisQuery.slice(0, 500),
          repositoryIds: params.codexRepositoryIds,
          limit: 5,
          channels: { semantic: true, keyword: true, symbol: true },
        }),
      });

      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
}

// ── Activity 3: Fetch Sentry errors ────────────────────────────────

export async function triageFetchSentryActivity(params: {
  sentryConfig: SentryConfig;
  messageBodies: string[];
}): Promise<unknown[]> {
  return fetchSentryContext(params.sentryConfig, params.messageBodies);
}

// ── Activity 4: Generate Linear issue body (LLM) ──────────────────

export async function generateLinearIssueActivity(params: {
  context: TriageContext;
  freshCodexFindings: unknown | null;
  freshSentryFindings: unknown | null;
}): Promise<{ title: string; description: string } | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[triage] LLM_API_KEY not set, skipping issue generation");
    return null;
  }

  // Merge fresh findings with existing analysis findings
  const analysis = {
    ...params.context.analysis,
    codexFindings: params.freshCodexFindings ?? params.context.analysis.codexFindings,
    sentryFindings: params.freshSentryFindings ?? params.context.analysis.sentryFindings,
  };

  const promptInput: TriagePromptInput = {
    analysis,
    messages: params.context.messages,
    customerDisplayName: params.context.customerDisplayName,
    threadTitle: params.context.threadTitle,
  };

  return generateLinearIssueBody(promptInput, {
    apiKey,
    model: params.context.agentModel ?? "gpt-4.1",
    timeoutMs: 15000,
  });
}

// ── Activity 5: Create/update Linear ticket ────────────────────────

export async function createOrUpdateLinearTicketActivity(params: {
  context: TriageContext;
  issueTitle: string;
  issueDescription: string;
}): Promise<{ id: string; identifier: string; url: string; action: "created" | "updated" } | null> {
  const { linearConfig } = params.context;
  if (!linearConfig) {
    console.log("[triage] Linear not configured, skipping ticket creation");
    return null;
  }

  const client = createLinearClient(linearConfig.apiKey);
  const priority = severityToPriority(params.context.analysis.severity);

  try {
    if (params.context.linearIssueId) {
      // Check if existing issue still exists
      const existing = await getLinearIssue(client, params.context.linearIssueId);
      if (existing) {
        const result = await updateLinearIssue(client, params.context.linearIssueId, {
          title: params.issueTitle,
          description: params.issueDescription,
          priority,
        });
        return { ...result, action: "updated" };
      }
    }

    // Create new issue
    const result = await createLinearIssue(client, {
      teamId: linearConfig.teamId,
      title: params.issueTitle,
      description: params.issueDescription,
      priority,
      labelNames: linearConfig.defaultLabels.length > 0 ? linearConfig.defaultLabels : undefined,
    });
    return { ...result, action: "created" };
  } catch (error) {
    console.error("[triage] Linear API error:", error);
    return null;
  }
}

// ── Activity 6: Generate eng spec (LLM) ───────────────────────────

export async function generateEngSpecActivity(params: {
  context: TriageContext;
  freshCodexFindings: unknown | null;
  freshSentryFindings: unknown | null;
}): Promise<{ specMarkdown: string; specTitle: string } | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[triage] LLM_API_KEY not set, skipping spec generation");
    return null;
  }

  const analysis = {
    ...params.context.analysis,
    codexFindings: params.freshCodexFindings ?? params.context.analysis.codexFindings,
    sentryFindings: params.freshSentryFindings ?? params.context.analysis.sentryFindings,
  };

  const promptInput: TriagePromptInput = {
    analysis,
    messages: params.context.messages,
    customerDisplayName: params.context.customerDisplayName,
    threadTitle: params.context.threadTitle,
  };

  return generateEngSpec(promptInput, {
    apiKey,
    model: params.context.agentModel ?? "gpt-4.1",
    timeoutMs: 20000,
  });
}

// ── Activity 7: Save triage result ─────────────────────────────────

export async function saveTriageResultActivity(params: {
  context: TriageContext;
  linearResult: { id: string; identifier: string; url: string; action: "created" | "updated" } | null;
  specMarkdown: string | null;
}): Promise<void> {
  const { context, linearResult, specMarkdown } = params;

  // Update thread with Linear issue link
  if (linearResult) {
    await prisma.supportThread.update({
      where: { id: context.threadId },
      data: {
        linearIssueId: linearResult.id,
        linearIssueUrl: linearResult.url,
      },
    });
  }

  // Create triage action audit log
  if (linearResult) {
    await prisma.triageAction.create({
      data: {
        threadId: context.threadId,
        workspaceId: context.workspaceId,
        analysisId: context.analysisId,
        action: linearResult.action === "created" ? "CREATE_TICKET" : "UPDATE_TICKET",
        linearIssueId: linearResult.identifier,
        linearIssueUrl: linearResult.url,
        createdById: context.triggeredByUserId,
      },
    });
  }

  if (specMarkdown) {
    await prisma.triageAction.create({
      data: {
        threadId: context.threadId,
        workspaceId: context.workspaceId,
        analysisId: context.analysisId,
        action: "GENERATE_SPEC",
        linearIssueId: linearResult?.identifier ?? null,
        specMarkdown,
        createdById: context.triggeredByUserId,
      },
    });
  }

  console.log(
    `[triage] saved: linear=${linearResult?.identifier ?? "none"} spec=${specMarkdown ? "yes" : "no"}`,
  );
}
