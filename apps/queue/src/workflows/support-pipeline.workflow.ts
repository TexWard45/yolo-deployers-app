import { proxyActivities, sleep } from "@temporalio/workflow";
import type {
  SupportPipelineWorkflowInput,
  SupportPipelineWorkflowResult,
} from "@shared/types";
import type * as activities from "../activities/index.js";

// ── Activity proxies ────────────────────────────────────────────────

// Fast activities (DB reads, evals)
const {
  // Gate evals
  evalGate1ShouldInvestigate,
  evalGate2ShouldTriage,
  evalGate3ShouldSpec,
  // Phase 1: Context (reuse from analyze-thread)
  getThreadAnalysisContext,
  checkSufficiencyActivity,
  escalateThreadActivity,
  // Phase 2: Investigation (reuse from analyze-thread)
  searchCodebaseActivity,
  expandChunkContextActivity,
  fetchSentryErrorsActivity,
  // Phase 3: Analysis (reuse from analyze-thread)
  generateDraftReplyActivity,
  saveAnalysisAndDraftActivity,
  // Phase 4: Triage (reuse from triage-thread)
  generateLinearIssueActivity,
  createOrUpdateLinearTicketActivity,
  // Phase 5: Spec (reuse from triage-thread)
  generateEngSpecActivity,
  saveTriageResultActivity,
  // Triage context (needed for phases 4-5)
  getTriageContext,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

// LLM-heavy activities need more time
const { generateAnalysisActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 seconds",
  retry: { maximumAttempts: 2 },
});

const DEBOUNCE_SECONDS = 60;

// ── Helper: build a "stopped" result ────────────────────────────────

function stopped(
  phase: SupportPipelineWorkflowResult["phase"],
  reason: string,
  partial?: Partial<SupportPipelineWorkflowResult>,
): SupportPipelineWorkflowResult {
  return {
    phase,
    analysisId: null,
    draftId: null,
    linearIssueId: null,
    linearIssueUrl: null,
    specMarkdown: null,
    reason,
    ...partial,
  };
}

/**
 * Master Support Pipeline Workflow.
 *
 * Single orchestrator that replaces the separate analyze + triage workflows.
 * 5 phases, 3 eval gates. Each step is a pluggable activity.
 *
 * ┌─ Gate 1 ──────────────────────────────┐
 * │  Should we investigate?               │
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Phase 1: Context ────────────────────┐
 * │  fetch thread → sufficiency check     │  ✅ PLUGGED IN
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Phase 2: Investigate ────────────────┐
 * │  Codex search ║ Sentry lookup         │  ✅ PLUGGED IN
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Phase 3: Analyze ───────────────────┐
 * │  LLM analysis → LLM draft → save     │  ✅ PLUGGED IN
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Gate 2 ──────────────────────────────┐
 * │  Should we auto-triage?               │  ✅ PLUGGED IN (basic)
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Phase 4: Triage ────────────────────┐
 * │  LLM issue body → Linear ticket       │  ✅ PLUGGED IN
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Gate 3 ──────────────────────────────┐
 * │  Should we generate spec?             │  ✅ PLUGGED IN (basic)
 * └───────────────┬───────────────────────┘
 *                 ▼
 * ┌─ Phase 5: Spec ──────────────────────┐
 * │  LLM eng spec → save                 │  ✅ PLUGGED IN
 * └───────────────────────────────────────┘
 */
export async function supportPipelineWorkflow(
  input: SupportPipelineWorkflowInput,
): Promise<SupportPipelineWorkflowResult> {

  // ────────────────────────────────────────────────────────────────
  // Debounce — let rapid messages settle
  // ────────────────────────────────────────────────────────────────
  await sleep(`${DEBOUNCE_SECONDS} seconds`);

  // ────────────────────────────────────────────────────────────────
  // GATE 1: Should we investigate?
  // ✅ PLUGGED IN — checks agent enabled, thread open, has messages
  // ────────────────────────────────────────────────────────────────
  const gate1 = await evalGate1ShouldInvestigate({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
  });

  if (!gate1.proceed) {
    return stopped("gate_1_investigate", gate1.reason);
  }

  // ────────────────────────────────────────────────────────────────
  // PHASE 1: Gather Context
  // ✅ PLUGGED IN — reuses getThreadAnalysisContext + checkSufficiency
  // ────────────────────────────────────────────────────────────────
  const context = await getThreadAnalysisContext(input);
  if (!context) {
    return stopped("phase_1_context", "context_fetch_failed");
  }

  const sufficiency = await checkSufficiencyActivity(context);
  if (!sufficiency) {
    return stopped("phase_1_context", "sufficiency_check_failed");
  }

  // Handle insufficient context — clarify or escalate
  if (!sufficiency.sufficient) {
    if (context.clarificationCount >= context.maxClarifications) {
      await escalateThreadActivity({ threadId: input.threadId });
      return stopped("phase_1_context", "escalated_max_clarifications");
    }

    const draft = await generateDraftReplyActivity({
      context,
      draftType: "CLARIFICATION",
      analysisResult: null,
      missingContext: sufficiency.missingContext,
    });

    if (!draft) {
      return stopped("phase_1_context", "clarification_draft_failed");
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

    return stopped("phase_1_context", "clarification_sent", {
      analysisId: saved?.analysisId ?? null,
      draftId: saved?.draftId ?? null,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // PHASE 2: Parallel Investigation
  // ✅ PLUGGED IN — Codex search + Sentry lookup
  // TODO: add session replay lookup
  // ────────────────────────────────────────────────────────────────
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
    // TODO: Step 2c — session replay lookup
    // fetchSessionReplayActivity({ ... })
  ]);

  // ────────────────────────────────────────────────────────────────
  // PHASE 3: Analyze + Draft
  // ✅ PLUGGED IN — LLM analysis → LLM draft → save
  // ────────────────────────────────────────────────────────────────
  // Expand chunk context (parent + siblings)
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

  const analysisResult = await generateAnalysisActivity({
    context,
    codexFindings: codexResults,
    sentryFindings: sentryResults,
    expandedContext,
  });

  if (!analysisResult) {
    return stopped("phase_3_analyze", "analysis_generation_failed");
  }

  const draft = await generateDraftReplyActivity({
    context,
    draftType: "RESOLUTION",
    analysisResult,
    missingContext: [],
  });

  if (!draft) {
    return stopped("phase_3_analyze", "draft_generation_failed");
  }

  const saved = await saveAnalysisAndDraftActivity({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    analysis: {
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

  const analysisId = saved?.analysisId ?? null;
  const draftId = saved?.draftId ?? null;

  if (!analysisId) {
    return stopped("phase_3_analyze", "save_failed");
  }

  // ────────────────────────────────────────────────────────────────
  // GATE 2: Should we auto-triage?
  // ✅ PLUGGED IN — checks Linear configured
  // TODO: severity threshold, confidence threshold, autoTriage flag
  // ────────────────────────────────────────────────────────────────
  const gate2 = await evalGate2ShouldTriage({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    severity: analysisResult.severity,
    confidence: analysisResult.confidence,
    issueCategory: analysisResult.issueCategory,
  });

  if (!gate2.proceed) {
    // Analysis done, but no auto-triage — human takes over from here
    return stopped("gate_2_triage", gate2.reason, {
      phase: "done",
      analysisId,
      draftId,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // PHASE 4: Triage to Linear
  // ✅ PLUGGED IN — LLM issue body → Linear SDK create/update
  // ────────────────────────────────────────────────────────────────
  const triageCtx = await getTriageContext({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    analysisId,
    triggeredByUserId: "pipeline-auto",
    mode: "FULL_TRIAGE",
  });

  let linearIssueId: string | null = null;
  let linearIssueUrl: string | null = null;

  if (triageCtx) {
    const issueBody = await generateLinearIssueActivity({
      context: triageCtx,
      freshCodexFindings: codexResults,
      freshSentryFindings: sentryResults,
    });

    if (issueBody && triageCtx.linearConfig) {
      const linearResult = await createOrUpdateLinearTicketActivity({
        context: triageCtx,
        issueTitle: issueBody.title,
        issueDescription: issueBody.description,
      });

      if (linearResult) {
        linearIssueId = linearResult.identifier;
        linearIssueUrl = linearResult.url;

        await saveTriageResultActivity({
          context: triageCtx,
          linearResult,
          specMarkdown: null,
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // GATE 3: Should we generate a spec?
  // ✅ PLUGGED IN — checks issue category is actionable
  // TODO: autoSpec flag, codex quality check, require Linear ticket
  // ────────────────────────────────────────────────────────────────
  const gate3 = await evalGate3ShouldSpec({
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    issueCategory: analysisResult.issueCategory,
    hasCodexFindings: codexResults !== null,
    linearIssueId,
  });

  if (!gate3.proceed) {
    return {
      phase: "done",
      analysisId,
      draftId,
      linearIssueId,
      linearIssueUrl,
      specMarkdown: null,
      reason: gate3.reason,
    };
  }

  // ────────────────────────────────────────────────────────────────
  // PHASE 5: Generate Eng Spec
  // ✅ PLUGGED IN — LLM spec → save
  // TODO: auto-create PR via GitHub API
  // ────────────────────────────────────────────────────────────────
  let specMarkdown: string | null = null;

  if (triageCtx) {
    const specResult = await generateEngSpecActivity({
      context: triageCtx,
      freshCodexFindings: codexResults,
      freshSentryFindings: sentryResults,
    });

    if (specResult) {
      specMarkdown = specResult.specMarkdown;

      await saveTriageResultActivity({
        context: triageCtx,
        linearResult: null,
        specMarkdown,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────
  // DONE
  // ────────────────────────────────────────────────────────────────
  return {
    phase: "done",
    analysisId,
    draftId,
    linearIssueId,
    linearIssueUrl,
    specMarkdown,
  };
}
