import { proxyActivities } from "@temporalio/workflow";
import type {
  TriageThreadWorkflowInput,
  TriageThreadWorkflowResult,
} from "@shared/types";
import type * as activities from "../activities/index.js";

// Standard activities (LLM calls up to 15-20s)
const {
  getTriageContext,
  triageSearchCodebaseActivity,
  triageFetchSentryActivity,
  fetchTelemetryFindingsActivity,
  generateLinearIssueActivity,
  createOrUpdateLinearTicketActivity,
  generateEngSpecActivity,
  saveTriageResultActivity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 seconds",
  retry: { maximumAttempts: 2 },
});

/**
 * Triage Pipeline Workflow.
 *
 * Triggered manually when user clicks "Triage" on a thread with analysis.
 * Steps:
 *   1. Get context (thread + analysis + config)
 *   2. Parallel: re-search codebase + fetch Sentry (fresh data)
 *   3. Generate Linear issue body (LLM)
 *   4. Create/update Linear ticket
 *   5. Generate eng spec (LLM)
 *   6. Save triage result (audit log + thread update)
 *
 * Each step is a pluggable activity — swap implementations independently.
 */
export async function triageThreadWorkflow(
  input: TriageThreadWorkflowInput,
): Promise<TriageThreadWorkflowResult> {
  const mode = input.mode ?? "FULL_TRIAGE";

  // ── Step 1: Get context ────────────────────────────────────────
  const context = await getTriageContext(input);
  if (!context) {
    return {
      linearIssueId: null,
      linearIssueUrl: null,
      specMarkdown: null,
      action: "skipped",
      reason: "context_not_found",
    };
  }

  // ── Step 2: Parallel investigation (fresh data) ────────────────
  // Build a search query from analysis summary + RCA
  const searchQuery = [
    context.analysis.summary,
    context.analysis.rcaSummary,
    context.analysis.affectedComponent,
  ]
    .filter(Boolean)
    .join(" ");

  const [freshCodex, freshSentry] = await Promise.all([
    context.codexRepositoryIds.length > 0
      ? triageSearchCodebaseActivity({
          workspaceId: input.workspaceId,
          codexRepositoryIds: context.codexRepositoryIds,
          analysisQuery: searchQuery,
        })
      : Promise.resolve(null),
    context.sentryConfig
      ? triageFetchSentryActivity({
          sentryConfig: context.sentryConfig,
          messageBodies: context.messages.map((m) => m.body),
        })
      : Promise.resolve([]),
  ]);

  const telemetryFindings = await fetchTelemetryFindingsActivity({
    telemetrySessionId: context.telemetrySessionId,
    customerEmail: context.customerEmail,
    threadCreatedAt: context.threadCreatedAt,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
  });

  // ── Step 3: Generate Linear issue body (LLM) ──────────────────
  const issueBody = mode === "FULL_TRIAGE"
    ? await generateLinearIssueActivity({
        context,
        freshCodexFindings: freshCodex,
        freshSentryFindings: freshSentry,
      })
    : null;

  // ── Step 4: Create/update Linear ticket ────────────────────────
  let linearResult: Awaited<ReturnType<typeof createOrUpdateLinearTicketActivity>> = null;

  if (mode === "FULL_TRIAGE" && issueBody && context.linearConfig) {
    linearResult = await createOrUpdateLinearTicketActivity({
      context,
      issueTitle: issueBody.title,
      issueDescription: issueBody.description,
    });
  }

  // ── Step 5: Generate eng spec (LLM) ───────────────────────────
  const specResult = await generateEngSpecActivity({
    context,
    freshCodexFindings: freshCodex,
    freshSentryFindings: freshSentry,
    telemetryFindings,
  });

  // ── Step 6: Save triage result ────────────────────────────────
  await saveTriageResultActivity({
    context,
    linearResult,
    specMarkdown: specResult?.specMarkdown ?? null,
  });

  // ── Return ────────────────────────────────────────────────────
  const action = mode === "SPEC_ONLY"
    ? (specResult ? "spec_generated" : "skipped")
    : linearResult
      ? "triaged"
      : specResult
        ? "spec_generated"
        : "skipped";

  return {
    linearIssueId: linearResult?.identifier ?? null,
    linearIssueUrl: linearResult?.url ?? null,
    specMarkdown: specResult?.specMarkdown ?? null,
    action,
    reason: !linearResult && !specResult ? "no_linear_config_and_llm_failed" : undefined,
  };
}
