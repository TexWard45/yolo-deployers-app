import { prisma } from "@shared/database";
import type { Prisma } from "@shared/types/prisma";
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
import { resolveSentryConfig } from "./helpers/sentry-config.js";

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
  investigationABEnabled: boolean;
  telemetrySessionId: string | null;
  customerEmail: string | null;
  threadCreatedAt: string | null;
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

  const sentryConfig: SentryConfig | null = resolveSentryConfig(config);
  const workspaceRepos = await prisma.codexRepository.findMany({
    where: { workspaceId: input.workspaceId },
    select: { id: true },
  });
  const availableRepoIds = workspaceRepos.map((repo) => repo.id);
  const availableRepoIdSet = new Set(availableRepoIds);
  const configuredRepoIds = config.codexRepositoryIds ?? [];
  const codexRepositoryIds =
    configuredRepoIds.length > 0
      ? configuredRepoIds.filter((repoId) => availableRepoIdSet.has(repoId))
      : availableRepoIds;
  if (codexRepositoryIds.length === 0) {
    console.warn(`[analyze-thread] no Codex repositories available for workspace ${input.workspaceId}`);
  }

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
    codexRepositoryIds,
    sentryConfig,
    investigationABEnabled: config.investigationABEnabled,
    telemetrySessionId: thread.telemetrySessionId,
    customerEmail: thread.customer.email,
    threadCreatedAt: thread.createdAt.toISOString(),
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
  rerank?: boolean;
  investigationABEnabled?: boolean;
  threadId?: string;
}): Promise<unknown | null> {
  if (params.codexRepositoryIds.length === 0) return null;

  // Build task description from last 3 messages + fingerprint
  const recentBodies = params.messages
    .slice(-3)
    .map((m) => m.body)
    .join("\n");
  const taskDescription = [recentBodies, params.issueFingerprint ? `Keywords: ${params.issueFingerprint}` : null]
    .filter(Boolean)
    .join("\n\n");

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
            taskDescription,
            maxResults: 5,
            rerank: params.rerank ?? false,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({ error: "unknown" })) as { error?: string; code?: string };
          console.warn(`[analyze-thread] agent-grep failed for repo ${repositoryId} (${response.status}): ${errorBody.error ?? "no details"}`);
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

    // A/B logging for rerank: compare reranked vs non-reranked results
    if (params.investigationABEnabled && params.rerank && params.threadId) {
      try {
        // Run a control search (without rerank) for comparison
        const controlResults = await Promise.all(
          params.codexRepositoryIds.map(async (repositoryId) => {
            const resp = await fetch(agentGrepUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaceId: params.workspaceId,
                repositoryId,
                taskDescription,
                maxResults: 5,
                rerank: false,
              }),
              signal: AbortSignal.timeout(30_000),
            });
            if (!resp.ok) return null;
            return (await resp.json()) as { chunks?: GrepChunk[] };
          }),
        );

        const controlChunks: GrepChunk[] = [];
        for (const r of controlResults) {
          if (r?.chunks) controlChunks.push(...r.chunks);
        }
        const controlTop5 = controlChunks.sort((a, b) => b.score - a.score).slice(0, 5);

        // Calculate chunk overlap: how many of the top-5 IDs are the same
        const variantIds = new Set(mergedChunks.map((c) => c.id));
        const controlIds = new Set(controlTop5.map((c) => c.id));
        const overlap = [...variantIds].filter((id) => controlIds.has(id)).length;
        const chunkOverlap = Math.max(variantIds.size, controlIds.size) > 0
          ? overlap / Math.max(variantIds.size, controlIds.size)
          : 1;

        await prisma.analysisABLog.create({
          data: {
            threadId: params.threadId,
            analysisId: "pending",
            workspaceId: params.workspaceId,
            phase: "rerank",
            controlResult: JSON.parse(JSON.stringify(controlTop5)) as Prisma.InputJsonValue,
            variantResult: JSON.parse(JSON.stringify(mergedChunks)) as Prisma.InputJsonValue,
            chunkOverlap,
          },
        });
      } catch (abError) {
        console.warn("[analyze-thread] rerank A/B log failed:", abError);
      }
    }

    // Return in the same shape as before (chunks array) so downstream consumers don't break
    return { chunks: mergedChunks };
  } catch (error) {
    console.warn("[analyze-thread] agent-grep error, falling back to direct search:", error);

    // Fallback to old /codex/search
    return searchCodebaseFallback(params);
  }
}

/** Fallback to the old direct search endpoint */
async function searchCodebaseFallback(params: {
  workspaceId: string;
  codexRepositoryIds: string[];
  messages: Array<{ body: string }>;
  issueFingerprint: string | null;
}): Promise<unknown | null> {
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
      console.warn(`[analyze-thread] fallback search failed (${response.status})`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("[analyze-thread] fallback search error:", error);
    return null;
  }
}

// ── Activity 3b: Expand chunk context (parent + siblings) ───────────

interface ChunkContextResult {
  parent: { symbolName: string | null; chunkType: string; content: string; file: { filePath: string } } | null;
  siblings: Array<{ symbolName: string | null; chunkType: string; content: string; file: { filePath: string } }>;
}

const MAX_CONTEXT_CHARS_PER_CHUNK = 4000;

function truncateContent(content: string, maxLen: number): string {
  return content.length > maxLen ? content.slice(0, maxLen) + "..." : content;
}

export async function expandChunkContextActivity(params: {
  chunkIds: string[];
  maxSiblings?: number;
  workspaceId?: string;
  threadId?: string;
  investigationABEnabled?: boolean;
}): Promise<Record<string, ChunkContextResult> | null> {
  if (params.chunkIds.length === 0) return null;

  const url = `${queueEnv.WEB_APP_URL}/api/rest/codex/chunk/batch-context`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunkIds: params.chunkIds,
        maxSiblings: params.maxSiblings ?? 3,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(`[analyze-thread] batch-context failed (${response.status})`);
      return null;
    }

    const raw = (await response.json()) as Record<string, ChunkContextResult>;

    // Truncate content to stay within token budget
    for (const [, ctx] of Object.entries(raw)) {
      if (ctx.parent) {
        ctx.parent.content = truncateContent(ctx.parent.content, MAX_CONTEXT_CHARS_PER_CHUNK);
      }
      for (const sib of ctx.siblings) {
        sib.content = truncateContent(sib.content, 500);
      }
    }

    // A/B logging
    if (params.investigationABEnabled && params.threadId && params.workspaceId) {
      const hasExpansion = Object.values(raw).some((ctx) => ctx.parent !== null || ctx.siblings.length > 0);
      try {
        await prisma.analysisABLog.create({
          data: {
            threadId: params.threadId,
            analysisId: "pending",
            workspaceId: params.workspaceId,
            phase: "context_expansion",
            controlResult: JSON.parse("null") as Prisma.InputJsonValue,
            variantResult: JSON.parse(JSON.stringify(raw)) as Prisma.InputJsonValue,
            tokenDelta: hasExpansion
              ? Object.values(raw).reduce((sum, ctx) => {
                  return sum + (ctx.parent?.content.length ?? 0) + ctx.siblings.reduce((s, sib) => s + sib.content.length, 0);
                }, 0)
              : 0,
          },
        });
      } catch (abError) {
        console.warn("[analyze-thread] context expansion A/B log failed:", abError);
      }
    }

    return raw;
  } catch (error) {
    console.warn("[analyze-thread] expand chunk context error:", error);
    return null;
  }
}

// ── Activity 4: Sentry error lookup ─────────────────────────────────

export async function fetchSentryErrorsActivity(params: {
  sentryConfig: SentryConfig;
  messageBodies: string[];
  investigationABEnabled?: boolean;
  threadId?: string;
  workspaceId?: string;
}): Promise<unknown[]> {
  const start = performance.now();
  console.log("[sentry-ab] searching with config:", { org: params.sentryConfig.orgSlug, project: params.sentryConfig.projectSlug, bodiesCount: params.messageBodies.length });
  const findings = await fetchSentryContext(params.sentryConfig, params.messageBodies);
  const latencyMs = Math.round(performance.now() - start);
  console.log("[sentry-ab] findings:", findings.length, "latency:", latencyMs, "ms");

  // A/B logging: record Sentry latency and results
  if (params.investigationABEnabled && params.threadId && params.workspaceId) {
    try {
      await prisma.analysisABLog.create({
        data: {
          threadId: params.threadId,
          analysisId: "pending", // updated after analysis is saved
          workspaceId: params.workspaceId,
          phase: "sentry",
          controlResult: JSON.parse("[]") as Prisma.InputJsonValue,
          variantResult: JSON.parse(JSON.stringify(findings)) as Prisma.InputJsonValue,
          latencyMs,
        },
      });
    } catch (error) {
      console.warn("[analyze-thread] A/B log write failed:", error);
    }
  }

  return findings;
}

// ── Activity 5: Generate structured analysis ────────────────────────

export async function generateAnalysisActivity(params: {
  context: AnalysisContext;
  codexFindings: unknown | null;
  sentryFindings: unknown | null;
  expandedContext?: unknown | null;
  telemetryFindings?: unknown | null;
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
    expandedContext: params.expandedContext ?? null,
    telemetryFindings: params.telemetryFindings ?? null,
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

// ── Activity 9: Fetch telemetry session findings ─────────────────────

export interface TelemetryFinding {
  sessionId: string;
  sessionUrl: string;
  errorCount: number;
  errors: Array<{
    message: string;
    timestamp: string;
  }>;
  userAgent: string | null;
}

export async function fetchTelemetryFindingsActivity(params: {
  telemetrySessionId: string | null;
  customerEmail: string | null;
  threadCreatedAt: string | null;
  workspaceId: string;
  threadId: string;
}): Promise<TelemetryFinding | null> {
  const webAppUrl = queueEnv.WEB_APP_URL;

  // Strategy 1: Direct session ID from the thread
  if (params.telemetrySessionId) {
    return fetchSessionFindings(params.telemetrySessionId, webAppUrl);
  }

  // Strategy 2: Find session by customer email + time proximity
  if (params.customerEmail) {
    try {
      const endTime = params.threadCreatedAt ? new Date(params.threadCreatedAt) : new Date();
      const startTime = new Date(endTime.getTime() - 60 * 60 * 1000);

      const response = await fetch(`${webAppUrl}/api/rest/telemetry.getExactErrorMoment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "0": {
            json: {
              customerEmail: params.customerEmail,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const result = (await response.json()) as Array<{ result?: { data?: { json?: { found: boolean; sessionId?: string } } } }>;
        const data = result[0]?.result?.data?.json;
        if (data?.found && data.sessionId) {
          const finding = await fetchSessionFindings(data.sessionId, webAppUrl);
          if (finding) {
            await linkSessionToThread(params.workspaceId, params.threadId, data.sessionId, webAppUrl);
            return finding;
          }
        }
      }
    } catch (error) {
      console.warn("[telemetry-findings] customer email lookup failed:", error);
    }
  }

  // Strategy 3: Time-proximity — find any error session created around the thread's creation time
  if (params.threadCreatedAt) {
    try {
      const threadTime = new Date(params.threadCreatedAt);
      // Look 30 min before and 5 min after thread creation
      const startTime = new Date(threadTime.getTime() - 30 * 60 * 1000);
      const endTime = new Date(threadTime.getTime() + 5 * 60 * 1000);

      const errorSession = await prisma.session.findFirst({
        where: {
          hasError: true,
          createdAt: { gte: startTime, lte: endTime },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (errorSession) {
        console.log(`[telemetry-findings] matched session ${errorSession.id} by time proximity`);
        const finding = await fetchSessionFindings(errorSession.id, webAppUrl);
        if (finding) {
          await linkSessionToThread(params.workspaceId, params.threadId, errorSession.id, webAppUrl);
          return finding;
        }
      }
    } catch (error) {
      console.warn("[telemetry-findings] time proximity lookup failed:", error);
    }
  }

  return null;
}

async function fetchSessionFindings(
  sessionId: string,
  webAppUrl: string,
): Promise<TelemetryFinding | null> {
  try {
    // Fetch session + timeline errors directly from DB (activity can use prisma)
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        errorCount: true,
        userAgent: true,
        timelines: {
          where: { type: "ERROR" },
          orderBy: { timestamp: "asc" },
          take: 10,
          select: { content: true, timestamp: true },
        },
      },
    });

    if (!session) {
      console.warn(`[telemetry-findings] session ${sessionId} not found`);
      return null;
    }

    return {
      sessionId: session.id,
      sessionUrl: `${webAppUrl}/admin/replays?id=${session.id}`,
      errorCount: session.errorCount,
      errors: session.timelines.map((t) => ({
        message: t.content,
        timestamp: t.timestamp.toISOString(),
      })),
      userAgent: session.userAgent,
    };
  } catch (error) {
    console.warn("[telemetry-findings] fetch session failed:", error);
    return null;
  }
}

async function linkSessionToThread(
  _workspaceId: string,
  threadId: string,
  sessionId: string,
  webAppUrl: string,
): Promise<void> {
  const replayUrl = `${webAppUrl}/admin/replays?id=${sessionId}`;
  const systemExternalMessageId = `system-telemetry-session-${sessionId}`;

  try {
    await prisma.supportThread.update({
      where: { id: threadId },
      data: { telemetrySessionId: sessionId },
    });
    console.log(`[telemetry-findings] linked session ${sessionId} to thread ${threadId}`);
  } catch (error) {
    console.warn("[telemetry-findings] failed to link session to thread:", error);
  }

  try {
    const existing = await prisma.threadMessage.findUnique({
      where: {
        threadId_externalMessageId: {
          threadId,
          externalMessageId: systemExternalMessageId,
        },
      },
      select: { id: true },
    });

    if (existing) return;

    await prisma.threadMessage.create({
      data: {
        threadId,
        direction: "SYSTEM",
        externalMessageId: systemExternalMessageId,
        body: `Session replay matched for developer investigation: ${replayUrl}`,
        metadata: {
          source: "telemetry-replay-link",
          telemetrySessionId: sessionId,
          telemetrySessionUrl: replayUrl,
        } as Prisma.InputJsonValue,
      },
    });

    console.log(`[telemetry-findings] posted replay link message for thread ${threadId}`);
  } catch (error) {
    console.warn("[telemetry-findings] failed to post replay link message:", error);
  }
}
