import { proxyActivities, sleep } from "@temporalio/workflow";
import type {
  AnalyzeThreadWorkflowInput,
  AnalyzeThreadWorkflowResult,
} from "@shared/types";
import type * as activities from "../activities/index.js";

// Standard activities (10-15s LLM calls)
const {
  getThreadAnalysisContext,
  checkSufficiencyActivity,
  searchCodebaseActivity,
  expandChunkContextActivity,
  fetchSentryErrorsActivity,
  generateDraftReplyActivity,
  saveAnalysisAndDraftActivity,
  escalateThreadActivity,
  fetchTelemetryFindingsActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

// Analysis generation needs more time (25s LLM timeout + overhead)
const { generateAnalysisActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 seconds",
  retry: { maximumAttempts: 2 },
});

const DEBOUNCE_SECONDS = 30;

/**
 * AI Thread Analysis & Auto-Response Pipeline.
 *
 * Triggered after each inbound message. Debounces rapid messages,
 * fetches telemetry session data, evaluates sufficiency (enriched with
 * telemetry errors), investigates via Codex + Sentry, generates
 * analysis and draft reply.
 */
export async function analyzeThreadWorkflow(
  input: AnalyzeThreadWorkflowInput,
): Promise<AnalyzeThreadWorkflowResult> {
  // 1. Debounce — let rapid messages settle
  await sleep(`${DEBOUNCE_SECONDS} seconds`);

  // 2. Fetch thread context + agent config
  const context = await getThreadAnalysisContext(input);
  if (!context) {
    return { analysisId: null, draftId: null, action: "skipped", reason: "agent_disabled_or_thread_closed" };
  }

  // 2b. Fetch telemetry session EARLY — before sufficiency check
  // Session errors (e.g. "Cannot read properties of undefined") enrich
  // vague customer messages so the sufficiency check can pass.
  const telemetryFindings = await fetchTelemetryFindingsActivity({
    telemetrySessionId: context.telemetrySessionId,
    customerEmail: context.customerEmail,
    threadCreatedAt: context.threadCreatedAt,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
  });

  // Enrich messages with telemetry errors for sufficiency check
  const enrichedContext = telemetryFindings && telemetryFindings.errors.length > 0
    ? {
        ...context,
        messages: [
          ...context.messages,
          {
            id: "__telemetry__",
            direction: "SYSTEM" as const,
            body: `[Session Replay Errors] ${telemetryFindings.errors.map((e) => e.message).join("; ")} (User Agent: ${telemetryFindings.userAgent ?? "unknown"})`,
            createdAt: context.threadCreatedAt ?? new Date().toISOString(),
          },
        ],
      }
    : context;

  // 3. Sufficiency check (now includes telemetry errors if available)
  const sufficiency = await checkSufficiencyActivity(enrichedContext);
  if (!sufficiency) {
    return { analysisId: null, draftId: null, action: "skipped", reason: "sufficiency_check_failed" };
  }

  // 4. Handle insufficient context
  if (!sufficiency.sufficient) {
    // Too many clarifications → escalate
    if (context.clarificationCount >= context.maxClarifications) {
      await escalateThreadActivity({ threadId: input.threadId });
      return { analysisId: null, draftId: null, action: "escalated", reason: "max_clarifications_reached" };
    }

    // Generate clarification draft
    const draft = await generateDraftReplyActivity({
      context,
      draftType: "CLARIFICATION",
      analysisResult: null,
      missingContext: sufficiency.missingContext,
    });

    if (!draft) {
      return { analysisId: null, draftId: null, action: "skipped", reason: "clarification_draft_failed" };
    }

    const saved = await saveAnalysisAndDraftActivity({
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      analysis: {
        issueCategory: null,
        severity: null,
        affectedComponent: null,
        summary: `Insufficient context: ${sufficiency.missingContext.join(", ")}`,
        codexFindings: null,
        sentryFindings: null,
        rcaSummary: null,
        sufficient: false,
        missingContext: sufficiency.missingContext,
        model: context.agentConfig.model,
        promptVersion: null,
        totalTokens: null,
        durationMs: null,
      },
      draft: {
        body: draft.body,
        draftType: "CLARIFICATION",
        basedOnMessageId: context.lastMessageId ?? undefined,
        model: context.agentConfig.model,
      },
    });

    return {
      analysisId: saved?.analysisId ?? null,
      draftId: saved?.draftId ?? null,
      action: "clarification",
    };
  }

  // 5. Parallel investigation: Codex search + Sentry lookup
  const [codexResults, sentryResults] = await Promise.all([
    context.codexRepositoryIds.length > 0
      ? searchCodebaseActivity({
          workspaceId: input.workspaceId,
          codexRepositoryIds: context.codexRepositoryIds,
          messages: context.messages,
          issueFingerprint: context.issueFingerprint,
          rerank: true,
          investigationABEnabled: context.investigationABEnabled,
          threadId: input.threadId,
        })
      : Promise.resolve(null),
    context.sentryConfig
      ? fetchSentryErrorsActivity({
          sentryConfig: context.sentryConfig,
          messageBodies: context.messages.map((m) => m.body),
          investigationABEnabled: context.investigationABEnabled,
          threadId: input.threadId,
          workspaceId: input.workspaceId,
        })
      : Promise.resolve([]),
  ]);

  // 5b. Expand chunk context (parent class + siblings)
  let expandedContext: unknown = null;
  if (codexResults) {
    const codex = codexResults as { chunks?: Array<{ id: string }> };
    const chunkIds = codex.chunks?.map((c) => c.id) ?? [];
    if (chunkIds.length > 0) {
      expandedContext = await expandChunkContextActivity({
        chunkIds,
        maxSiblings: 3,
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        investigationABEnabled: context.investigationABEnabled,
      });
    }
  }

  // 6. Generate structured analysis
  const analysisResult = await generateAnalysisActivity({
    context,
    codexFindings: codexResults,
    sentryFindings: sentryResults,
    expandedContext,
    telemetryFindings,
  });

  if (!analysisResult) {
    return { analysisId: null, draftId: null, action: "skipped", reason: "analysis_generation_failed" };
  }

  // 7. Generate resolution draft
  const draft = await generateDraftReplyActivity({
    context,
    draftType: "RESOLUTION",
    analysisResult,
    missingContext: [],
  });

  if (!draft) {
    return { analysisId: null, draftId: null, action: "skipped", reason: "resolution_draft_failed" };
  }

  // 8. Save analysis + draft
  const saved = await saveAnalysisAndDraftActivity({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    analysis: {
      threadLabel: analysisResult.threadLabel ?? null,
      issueCategory: analysisResult.issueCategory,
      severity: analysisResult.severity,
      affectedComponent: analysisResult.affectedComponent,
      summary: analysisResult.summary,
      codexFindings: codexResults,
      sentryFindings: sentryResults,
      rcaSummary: analysisResult.rcaSummary,
      sufficient: true,
      missingContext: [],
      model: context.agentConfig.model,
      promptVersion: null,
      totalTokens: null,
      durationMs: null,
    },
    draft: {
      body: draft.body,
      draftType: "RESOLUTION",
      basedOnMessageId: context.lastMessageId ?? undefined,
      model: context.agentConfig.model,
    },
  });

  return {
    analysisId: saved?.analysisId ?? null,
    draftId: saved?.draftId ?? null,
    action: "resolution",
  };
}
