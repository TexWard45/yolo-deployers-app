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
  resolveFixTargetRepository,
  createFixPullRequest,
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
        workspaceId: context.workspaceId,
        summary: context.summary,
        rcaSummary: context.rcaSummary,
        repositoryIds: context.codexRepositoryIds,
        messages: context.messages,
        codexFindings: context.codexFindings,
      }),
    ]);

    const targetRepository = await resolveFixTargetRepository({
      repositoryIds: context.codexRepositoryIds,
      filePaths: codeContext.editScope,
      preferredOwner: context.github.owner,
      preferredRepo: context.github.repo,
      configuredBaseBranch: context.github.baseBranch,
    });
    const githubToken = context.github.token;
    const canCreatePullRequest = Boolean(
      targetRepository?.canCreatePullRequest
      && targetRepository.owner
      && targetRepository.repo
      && githubToken,
    );
    const workingDirectory = targetRepository?.localPath;

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
        workingDirectory,
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
        workingDirectory,
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
          workingDirectory,
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
        if (canCreatePullRequest && targetRepository && githubToken) {
          try {
            const pr = await createFixPullRequest({
              runId: input.runId,
              summary: fixerOutput.summary,
              patchPlan: fixerOutput.patchPlan,
              changedFiles: applied.appliedFiles,
              targetRepository,
              workingDirectory: targetRepository.localPath,
              githubToken,
              iteration,
            });

            await saveFixRunProgress({
              runId: input.runId,
              status: "PASSED",
              currentStage: "PASSED",
              headSha: pr.headSha,
              branchName: pr.branchName,
              prUrl: pr.prUrl,
              prNumber: pr.prNumber,
              summary: fixerOutput.summary,
              lastError: null,
            });

            return {
              runId: input.runId,
              status: "PASSED",
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await saveFixRunProgress({
              runId: input.runId,
              status: "WAITING_REVIEW",
              currentStage: "WAITING_REVIEW",
              headSha: applied.headSha,
              summary: fixerOutput.summary,
              lastError: `Automatic PR creation failed: ${message}`,
              iteration: {
                iteration,
                status: "FAILED",
                fixPlan: fixerOutput,
                reviewFindings: reviewerOutput,
                checkResults: checksOutput,
                appliedFiles: applied.appliedFiles,
                completed: true,
              },
            });

            return {
              runId: input.runId,
              status: "WAITING_REVIEW",
            };
          }
        }

        await saveFixRunProgress({
          runId: input.runId,
          status: "WAITING_REVIEW",
          currentStage: "WAITING_REVIEW",
          headSha: applied.headSha,
          summary: fixerOutput.summary,
          lastError: "Automatic PR creation is disabled or not configured for this workspace/repo.",
          iteration: {
            iteration,
            status: "PASSED",
            fixPlan: fixerOutput,
            reviewFindings: reviewerOutput,
            checkResults: checksOutput,
            appliedFiles: applied.appliedFiles,
            completed: true,
          },
        });

        return {
          runId: input.runId,
          status: "WAITING_REVIEW",
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
