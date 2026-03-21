import { proxyActivities } from "@temporalio/workflow";
import type {
  GenerateFixPRWorkflowInput,
  FixPrChecksOutput,
  FixPrReviewerOutput,
} from "@shared/types";
import type * as activities from "../activities/index.js";

const {
  getFixRunContext,
  startParentCodexThread,
  runRcaAgent,
  runCodeContextAgent,
  runTestAgent,
  runFixerAgent,
  applyWorkspacePatch,
  runReviewerAgent,
  runChecksAgent,
  saveFixRunProgress,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 2,
  },
});

export interface GenerateFixPRWorkflowResult {
  runId: string;
  status: "PASSED" | "WAITING_REVIEW" | "FAILED" | "CANCELLED";
}

export async function generateFixPRWorkflow(
  input: GenerateFixPRWorkflowInput,
): Promise<GenerateFixPRWorkflowResult> {
  const context = await getFixRunContext(input);
  if (!context) {
    return {
      runId: input.runId,
      status: "CANCELLED",
    };
  }

  try {
    await saveFixRunProgress({
      runId: input.runId,
      status: "RUNNING",
      currentStage: "COLLECTING_CONTEXT",
    });

    const parentThreadId = await startParentCodexThread({
      runId: input.runId,
      analysisId: input.analysisId,
    });

    await saveFixRunProgress({
      runId: input.runId,
      parentThreadId,
      currentStage: "COLLECTING_CONTEXT",
      status: "RUNNING",
    });

    const [rca, codeContext] = await Promise.all([
      runRcaAgent({
        summary: context.summary,
        rcaSummary: context.rcaSummary,
        codexFindings: context.codexFindings,
        sentryFindings: context.sentryFindings,
      }),
      runCodeContextAgent({
        codexFindings: context.codexFindings,
      }),
    ]);

    const testPlan = await runTestAgent({
      codeContext,
      requiredCheckNames: context.requiredCheckNames,
    });

    await saveFixRunProgress({
      runId: input.runId,
      currentStage: "PLANNING",
      rcaSummary: rca.summary,
      rcaConfidence: rca.confidence,
      rcaSignals: rca.evidence,
      metadata: {
        codeContext,
        testPlan,
      },
    });

    let priorFailures: string[] = [];

    for (let iteration = 1; iteration <= context.maxIterations; iteration += 1) {
      await saveFixRunProgress({
        runId: input.runId,
        currentStage: "FIXING",
        incrementIterationCount: true,
        iteration: {
          iteration,
          status: "RUNNING",
        },
      });

      const fixerOutput = await runFixerAgent({
        rca,
        codeContext,
        testPlan,
        priorFailures,
        model: context.models.fix,
        codexFindings: context.codexFindings,
      });

      if (fixerOutput.changedFiles.length === 0) {
        const confidence = fixerOutput.confidence ?? 0;
        await saveFixRunProgress({
          runId: input.runId,
          status: "WAITING_REVIEW",
          currentStage: "WAITING_REVIEW",
          summary: `${fixerOutput.summary} (confidence: ${Math.round(confidence * 100)}%)`,
          lastError: fixerOutput.riskNotes.join("; "),
          iteration: {
            iteration,
            status: "FAILED",
            fixPlan: fixerOutput,
            appliedFiles: [],
            completed: true,
          },
        });

        return {
          runId: input.runId,
          status: "WAITING_REVIEW",
        };
      }

      const applied = await applyWorkspacePatch({
        fixerOutput,
      });

      const [reviewerOutput, checksOutput] = await Promise.all([
        runReviewerAgent({
          rca,
          fixerOutput,
          testPlan,
          model: context.models.review,
        }),
        runChecksAgent({
          commands: testPlan.commands,
        }),
      ]);

      const iterationStatus = reviewerOutput.approved && checksOutput.passed ? "PASSED" : "FAILED";

      await saveFixRunProgress({
        runId: input.runId,
        currentStage: iterationStatus === "PASSED" ? "PASSED" : "ITERATING",
        headSha: applied.headSha,
        summary: fixerOutput.summary,
        lastError: buildFailureSummary(reviewerOutput, checksOutput),
        iteration: {
          iteration,
          status: iterationStatus,
          fixPlan: fixerOutput,
          reviewFindings: reviewerOutput,
          checkResults: checksOutput,
          appliedFiles: applied.appliedFiles,
          completed: true,
        },
      });

      if (reviewerOutput.approved && checksOutput.passed) {
        await saveFixRunProgress({
          runId: input.runId,
          status: "PASSED",
          currentStage: "PASSED",
        });

        return {
          runId: input.runId,
          status: "PASSED",
        };
      }

      priorFailures = collectFailureMessages(reviewerOutput, checksOutput);
    }

    await saveFixRunProgress({
      runId: input.runId,
      status: "WAITING_REVIEW",
      currentStage: "WAITING_REVIEW",
      lastError: priorFailures.join("; "),
    });

    return {
      runId: input.runId,
      status: "WAITING_REVIEW",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await saveFixRunProgress({
      runId: input.runId,
      status: "FAILED",
      currentStage: "FAILED",
      lastError: message,
    });

    return {
      runId: input.runId,
      status: "FAILED",
    };
  }
}

export function collectFailureMessages(
  reviewerOutput: FixPrReviewerOutput,
  checksOutput: FixPrChecksOutput,
): string[] {
  return [
    ...reviewerOutput.blockers.map((blocker) => blocker.message),
    ...checksOutput.failures,
  ];
}

export function buildFailureSummary(
  reviewerOutput: FixPrReviewerOutput,
  checksOutput: FixPrChecksOutput,
): string | null {
  const failures = collectFailureMessages(reviewerOutput, checksOutput);
  return failures.length > 0 ? failures.join("; ") : null;
}
