import { prisma } from "@shared/database";
import {
  checkSufficiency,
  analyzeThread,
  generateDraftReply,
  fetchSentryContext,
} from "@shared/rest";
import type {
  SufficiencyCheckInput,
  ThreadAnalysisInput,
  DraftReplyInput,
  SentryConfig,
} from "@shared/rest";
import type {
  AnalyzeThreadWorkflowInput,
  SufficiencyCheckResult,
  ThreadAnalysisResult,
  DraftReplyResult,
  SaveAnalysisInput,
} from "@shared/types";
import { queueEnv } from "@shared/env/queue";

// ── Internal types ──────────────────────────────────────────────────

export interface AnalysisContext {
  threadId: string;
  workspaceId: string;
  clarificationCount: number;
  maxClarifications: number;
  issueFingerprint: string | null;
  threadSummary: string | null;
  customerDisplayName: string;
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    createdAt: string;
  }>;
  lastMessageId: string | null;
  agentConfig: {
    tone: string | null;
    systemPrompt: string | null;
    model: string | null;
  };
  codexRepositoryIds: string[];
  sentryConfig: SentryConfig | null;
}

// ── Activity 1: Fetch thread analysis context ───────────────────────

export async function getThreadAnalysisContext(
  input: AnalyzeThreadWorkflowInput,
): Promise<AnalysisContext | null> {
  const config = await prisma.workspaceAgentConfig.findUnique({
    where: { workspaceId: input.workspaceId },
  });

  if (!config?.enabled || !config.analysisEnabled) {
    console.log("[analyze-thread] agent disabled or analysis disabled, skipping");
    return null;
  }

  const thread = await prisma.supportThread.findUnique({
    where: { id: input.threadId },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "asc" }, take: 20 },
    },
  });

  if (!thread || thread.status === "CLOSED") {
    console.log("[analyze-thread] thread not found or closed, skipping");
    return null;
  }

  const inboundMessages = thread.messages.filter((m) => m.direction === "INBOUND");
  if (inboundMessages.length === 0) {
    console.log("[analyze-thread] no inbound messages, skipping");
    return null;
  }

  const sentryConfig: SentryConfig | null =
    config.sentryOrgSlug && config.sentryProjectSlug && config.sentryAuthToken
      ? {
          orgSlug: config.sentryOrgSlug,
          projectSlug: config.sentryProjectSlug,
          authToken: config.sentryAuthToken,
        }
      : null;

  return {
    threadId: thread.id,
    workspaceId: input.workspaceId,
    clarificationCount: thread.clarificationCount,
    maxClarifications: config.maxClarifications,
    issueFingerprint: thread.issueFingerprint,
    threadSummary: thread.summary,
    customerDisplayName: thread.customer.displayName,
    messages: thread.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    lastMessageId: thread.messages.at(-1)?.id ?? null,
    agentConfig: {
      tone: config.tone,
      systemPrompt: config.systemPrompt,
      model: config.model,
    },
    codexRepositoryIds: config.codexRepositoryIds,
    sentryConfig,
  };
}

// ── Activity 2: Sufficiency check ───────────────────────────────────

export async function checkSufficiencyActivity(
  context: AnalysisContext,
): Promise<SufficiencyCheckResult | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[analyze-thread] LLM_API_KEY not set, skipping sufficiency check");
    return null;
  }

  const input: SufficiencyCheckInput = {
    messages: context.messages,
    customerDisplayName: context.customerDisplayName,
    issueFingerprint: context.issueFingerprint,
    threadSummary: context.threadSummary,
  };

  return checkSufficiency(input, {
    apiKey,
    model: context.agentConfig.model ?? "gpt-4.1",
    timeoutMs: 15000,
  });
}

// ── Activity 3: Codebase search via Codex REST ──────────────────────

export async function searchCodebaseActivity(params: {
  workspaceId: string;
  codexRepositoryIds: string[];
  messages: Array<{ body: string }>;
  issueFingerprint: string | null;
}): Promise<unknown | null> {
  if (params.codexRepositoryIds.length === 0) return null;

  // Build query from last 3 messages + fingerprint
  const recentBodies = params.messages
    .slice(-3)
    .map((m) => m.body)
    .join(" ");
  const query = [recentBodies, params.issueFingerprint].filter(Boolean).join(" ").slice(0, 500);

  const url = `${queueEnv.WEB_APP_URL}/api/rest/codex/search`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        query,
        repositoryIds: params.codexRepositoryIds,
        limit: 5,
        channels: { semantic: true, keyword: true, symbol: true },
      }),
    });

    if (!response.ok) {
      console.warn(`[analyze-thread] codex search failed (${response.status})`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("[analyze-thread] codex search error:", error);
    return null;
  }
}

// ── Activity 4: Sentry error lookup ─────────────────────────────────
// TODO: Phase 2 — plug in real Sentry Web API integration here.
// Currently returns [] via the stub in sentry-client.ts.
// When implementing:
//   1. Fill in fetchSentryContext() in packages/rest/src/routers/helpers/sentry-client.ts
//      - extractErrorSignals() from message bodies (already implemented)
//      - GET /api/0/projects/{org}/{project}/issues/?query=... to search issues
//      - GET /api/0/issues/{issueId}/events/latest/ to get stack traces
//   2. This activity is already wired into the workflow (step 4, parallel with Codex)
//   3. Results flow into generateAnalysisActivity as sentryFindings
//   4. The analysis LLM prompt already handles Sentry data in its buildUserMessage()

export async function fetchSentryErrorsActivity(params: {
  sentryConfig: SentryConfig;
  messageBodies: string[];
}): Promise<unknown[]> {
  return fetchSentryContext(params.sentryConfig, params.messageBodies);
}

// ── Activity 5: Generate structured analysis ────────────────────────

export async function generateAnalysisActivity(params: {
  context: AnalysisContext;
  codexFindings: unknown | null;
  sentryFindings: unknown | null;
}): Promise<ThreadAnalysisResult | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[analyze-thread] LLM_API_KEY not set, skipping analysis");
    return null;
  }

  const input: ThreadAnalysisInput = {
    messages: params.context.messages,
    customerDisplayName: params.context.customerDisplayName,
    issueFingerprint: params.context.issueFingerprint,
    threadSummary: params.context.threadSummary,
    codexFindings: params.codexFindings,
    sentryFindings: params.sentryFindings,
  };

  return analyzeThread(input, {
    apiKey,
    model: params.context.agentConfig.model ?? "gpt-4.1",
    timeoutMs: 25000,
  });
}

// ── Activity 6: Generate draft reply ────────────────────────────────

export async function generateDraftReplyActivity(params: {
  context: AnalysisContext;
  draftType: "RESOLUTION" | "CLARIFICATION";
  analysisResult: ThreadAnalysisResult | null;
  missingContext: string[];
}): Promise<DraftReplyResult | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[analyze-thread] LLM_API_KEY not set, skipping draft generation");
    return null;
  }

  const input: DraftReplyInput = {
    draftType: params.draftType,
    analysisResult: params.analysisResult,
    missingContext: params.missingContext,
    messages: params.context.messages.map((m) => ({
      direction: m.direction,
      body: m.body,
    })),
    customerDisplayName: params.context.customerDisplayName,
    tone: params.context.agentConfig.tone,
    customSystemPrompt: params.context.agentConfig.systemPrompt,
  };

  return generateDraftReply(input, {
    apiKey,
    model: params.context.agentConfig.model ?? "gpt-4.1",
    timeoutMs: 15000,
  });
}

// ── Activity 7: Save analysis + draft via REST ──────────────────────

export async function saveAnalysisAndDraftActivity(
  input: SaveAnalysisInput,
): Promise<{ analysisId: string; draftId: string } | null> {
  const url = `${queueEnv.WEB_APP_URL}/api/rest/analysis/save`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": queueEnv.INTERNAL_API_SECRET,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[analyze-thread] save failed (${response.status}): ${body}`);
      return null;
    }

    return (await response.json()) as { analysisId: string; draftId: string };
  } catch (error) {
    console.error("[analyze-thread] save error:", error);
    return null;
  }
}

// ── Activity 8: Escalate thread via direct DB update ────────────────

export async function escalateThreadActivity(params: {
  threadId: string;
}): Promise<void> {
  await prisma.supportThread.update({
    where: { id: params.threadId },
    data: { status: "ESCALATED" },
  });
  console.log(`[analyze-thread] escalated thread ${params.threadId}`);
}
