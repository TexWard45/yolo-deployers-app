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
  cloneRepository,
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

interface FixPrWorkflowInputLike {
  debugLogs?: boolean;
}

function createWorkflowDebugLogger(input: FixPrWorkflowInputLike) {
  const debugEnabled = Boolean(input.debugLogs);
  return (message: string, ...rest: unknown[]) => {
    if (!debugEnabled) return;
    console.log(`[fix-pr][workflow] ${message}`, ...rest);
  };
}

export interface GenerateFixPRWorkflowResult {
  runId: string;
  status: "PASSED" | "WAITING_REVIEW" | "FAILED" | "CANCELLED";
}

export async function generateFixPRWorkflow(
  input: GenerateFixPRWorkflowInput,
): Promise<GenerateFixPRWorkflowResult> {
  const debugLog = createWorkflowDebugLogger(input);
  debugLog("workflow started", {
    runId: input.runId,
    threadId: input.threadId,
    workspaceId: input.workspaceId,
    analysisId: input.analysisId,
  });
  const context = await getFixRunContext(input);
  if (!context) {
    return {
      runId: input.runId,
      status: "CANCELLED",
    };
  }

  debugLog("workflow context", {
    runId: context.runId,
    analysisId: context.analysisId,
    githubOwner: context.github.owner,
    githubRepo: context.github.repo,
    baseBranch: context.github.baseBranch,
    repoCount: context.codexRepositoryIds.length,
  });

  try {
    debugLog("workflow state", { runId: input.runId, stage: "COLLECTING_CONTEXT" });
    await saveFixRunProgress({
      runId: input.runId,
      status: "RUNNING",
      currentStage: "COLLECTING_CONTEXT",
    });

    const parentThreadId = await startParentCodexThread({
      runId: input.runId,
      analysisId: input.analysisId,
    });
    debugLog("workflow parent thread", { runId: input.runId, parentThreadId });

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

    debugLog("workflow context resolved", {
      runId: input.runId,
      editScopeCount: codeContext.editScope.length,
      symbolCount: codeContext.symbols.length,
      relatedChunkCount: codeContext.relatedChunks.length,
      filesCount: codeContext.files.length,
      rcaConfidence: rca.confidence,
    });

    const targetRepository = await resolveFixTargetRepository({
      repositoryIds: context.codexRepositoryIds,
      filePaths: codeContext.editScope,
      preferredOwner: context.github.owner,
      preferredRepo: context.github.repo,
      configuredBaseBranch: context.github.baseBranch,
    });
    if (!targetRepository) {
      debugLog("workflow no target repository", {
        runId: input.runId,
        repositoryIds: context.codexRepositoryIds,
      });
      await saveFixRunProgress({
        runId: input.runId,
        status: "WAITING_REVIEW",
        currentStage: "WAITING_REVIEW",
        lastError: "Unable to resolve a target repository for this fix run.",
      });
      return {
        runId: input.runId,
        status: "WAITING_REVIEW",
      };
    }
    debugLog("workflow target repository", {
      runId: input.runId,
      targetRepository,
    });
    const githubToken = context.github.token;
    const syncedRepo = await cloneRepository({
      repositoryId: targetRepository.repositoryId,
    });

    const workingDirectory = syncedRepo.localPath;
    if (!workingDirectory) {
      throw new Error("No target repository was resolved for this fix run.");
    }

    const canCreatePullRequest = Boolean(
      targetRepository.canCreatePullRequest
      || (
        targetRepository.owner
        && targetRepository.repo
        && githubToken
        && workingDirectory.length > 0
      ),
    );
    debugLog("workflow target decision", {
      runId: input.runId,
      canCreatePullRequest,
      workingDirectory,
    });

    const testPlan = await runTestAgent({
      codeContext,
      requiredCheckNames: context.requiredCheckNames,
    });
    debugLog("workflow test plan", {
      runId: input.runId,
      commands: testPlan.commands,
      requiredChecks: testPlan.requiredChecks,
      rationale: testPlan.rationale,
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
      debugLog("workflow iteration start", {
        runId: input.runId,
        iteration,
      });
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
        targetRepositoryId: targetRepository.repositoryId,
      });
      debugLog("workflow fixer output", {
        runId: input.runId,
        iteration,
        changedFileCount: fixerOutput.changedFiles.length,
        summary: fixerOutput.summary,
        cannotFixSafely: fixerOutput.cannotFixSafely,
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
        targetRepositoryId: targetRepository.repositoryId,
      });
      debugLog("workflow applied patch", {
        runId: input.runId,
        iteration,
        appliedFiles: applied.appliedFiles,
        headSha: applied.headSha,
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
      debugLog("workflow iteration result", {
        runId: input.runId,
        iteration,
        iterationStatus,
        reviewerApproved: reviewerOutput.approved,
        checksPassed: checksOutput.passed,
      });

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
            debugLog("workflow creating PR", {
              runId: input.runId,
              iteration,
              changedFiles: applied.appliedFiles,
            });
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
            debugLog("workflow PR created", {
              runId: input.runId,
              iteration,
              branchName: pr.branchName,
              prUrl: pr.prUrl,
              prNumber: pr.prNumber,
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
            debugLog("workflow PR creation failed", {
              runId: input.runId,
              iteration,
              message,
            });
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
      debugLog("workflow prior failures updated", {
        runId: input.runId,
        iteration,
        priorFailuresCount: priorFailures.length,
      });
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
    debugLog("workflow failed", { runId: input.runId, message });

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
