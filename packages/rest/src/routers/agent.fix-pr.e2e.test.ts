import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
function setRestTestEnv(): void {
  process.env.NODE_ENV ??= "test";
  process.env.TEMPORAL_ADDRESS ??= "localhost:7233";
  process.env.TEMPORAL_NAMESPACE ??= "default";
  process.env.TEMPORAL_TASK_QUEUE ??= "support-queue";
  process.env.CODEX_TASK_QUEUE ??= "codex-queue";
  process.env.INTERNAL_API_SECRET ??= "test-secret";
}

test("generateFixPR returns an existing active run without creating a duplicate", async () => {
  setRestTestEnv();
  const prisma = {
    workspaceMember: {
      findUnique: async () => ({ id: "member-1" }),
    },
    threadAnalysis: {
      findUnique: async () => ({
        id: "analysis-1",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        thread: { id: "thread-1" },
      }),
    },
    workspaceAgentConfig: {
      findUnique: async () => null,
    },
    fixPrRun: {
      findUnique: async () => ({
        id: "run-1",
        status: "RUNNING",
      }),
    },
  };

  const { createCallerFactory } = await import("../init");
  const { agentRouter } = await import("./agent");
  const caller = createCallerFactory(agentRouter)({
    prisma: prisma as never,
    sessionUserId: "user-1",
  });
  const result = await caller.generateFixPR({
    threadId: "thread-1",
    workspaceId: "workspace-1",
    analysisId: "analysis-1",
    userId: "user-1",
  });

  assert.deepEqual(result, {
    runId: "run-1",
    status: "RUNNING",
    alreadyRunning: true,
  });
});

test("getFixPRStatus returns serialized run details for the latest thread run", async () => {
  setRestTestEnv();
  const prisma = {
    workspaceMember: {
      findUnique: async () => ({ id: "member-1" }),
    },
    fixPrRun: {
      findFirst: async () => ({
        id: "run-1",
        status: "WAITING_REVIEW",
        currentStage: "WAITING_REVIEW",
        parentThreadId: "parent-thread-1",
        iterationCount: 2,
        maxIterations: 3,
        summary: "Needs review",
        lastError: "npm run type-check",
        prUrl: null,
        prNumber: null,
        branchName: "fix/thread-1",
        rcaSummary: "Null handling bug",
        rcaConfidence: 0.82,
        iterations: [
          {
            id: "iter-2",
            iteration: 2,
            status: "FAILED",
            fixPlan: { summary: "retry" },
            reviewFindings: { blockers: [] },
            checkResults: { failures: ["npm run type-check"] },
            appliedFiles: ["apps/web/src/page.tsx"],
            startedAt: new Date("2026-03-21T02:00:00.000Z"),
            completedAt: new Date("2026-03-21T02:05:00.000Z"),
          },
        ],
      }),
    },
  };

  const { createCallerFactory } = await import("../init");
  const { agentRouter } = await import("./agent");
  const caller = createCallerFactory(agentRouter)({
    prisma: prisma as never,
    sessionUserId: "user-1",
  });
  const result = await caller.getFixPRStatus({
    threadId: "thread-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });

  assert.deepEqual(result, {
    runId: "run-1",
    status: "WAITING_REVIEW",
    currentStage: "WAITING_REVIEW",
    parentThreadId: "parent-thread-1",
    iterationCount: 2,
    maxIterations: 3,
    summary: "Needs review",
    lastError: "npm run type-check",
    prUrl: null,
    prNumber: null,
    branchName: "fix/thread-1",
    rcaSummary: "Null handling bug",
    rcaConfidence: 0.82,
    iterations: [
      {
        id: "iter-2",
        iteration: 2,
        status: "FAILED",
        fixPlan: { summary: "retry" },
        reviewFindings: { blockers: [] },
        checkResults: { failures: ["npm run type-check"] },
        appliedFiles: ["apps/web/src/page.tsx"],
        startedAt: "2026-03-21T02:00:00.000Z",
        completedAt: "2026-03-21T02:05:00.000Z",
      },
    ],
  });
});

test("saveFixPRProgress upserts iteration state and creates a triage action on terminal status", async () => {
  setRestTestEnv();
  const fixPrRunUpdates: unknown[] = [];
  const iterationUpserts: unknown[] = [];
  const triageActionCreates: unknown[] = [];

  const prisma = {
    fixPrRun: {
      findUnique: async () => ({
        id: "run-1",
        analysisId: "analysis-1",
        threadId: "thread-1",
        workspaceId: "workspace-1",
        createdById: "user-1",
        prUrl: null,
        currentStage: "FIXING",
      }),
      update: async (input: unknown) => {
        fixPrRunUpdates.push(input);
        return input;
      },
    },
    fixPrIteration: {
      upsert: async (input: unknown) => {
        iterationUpserts.push(input);
        return input;
      },
    },
    triageAction: {
      findFirst: async () => null,
      create: async (input: unknown) => {
        triageActionCreates.push(input);
        return input;
      },
    },
  };

  const { createCallerFactory } = await import("../init");
  const { agentRouter } = await import("./agent");
  const caller = createCallerFactory(agentRouter)({
    prisma: prisma as never,
    sessionUserId: "user-1",
  });
  const result = await caller.saveFixPRProgress({
    runId: "run-1",
    status: "WAITING_REVIEW",
    currentStage: "WAITING_REVIEW",
    summary: "Needs human review",
    lastError: "Reviewer flagged missing guard",
    iteration: {
      iteration: 1,
      status: "FAILED",
      fixPlan: {
        summary: "Attempted fix",
        changedFiles: [],
        patchPlan: "patch",
        riskNotes: ["Needs follow-up"],
        cannotFixSafely: false,
      },
      reviewFindings: {
        approved: false,
        blockers: [{ severity: "blocker", message: "Missing guard", filePath: "apps/web/src/page.tsx" }],
        warnings: [],
        notes: [],
        missingTests: [],
      },
      checkResults: {
        passed: false,
        commandsRun: [],
        failures: ["npm run type-check"],
        logs: [],
      },
      appliedFiles: ["apps/web/src/page.tsx"],
      completed: true,
    },
  });

  assert.deepEqual(result, { saved: true });
  assert.equal(fixPrRunUpdates.length, 1);
  assert.equal(iterationUpserts.length, 1);
  assert.equal(triageActionCreates.length, 1);
});

test("getFixPRStatus rejects non-members", async () => {
  setRestTestEnv();
  const prisma = {
    workspaceMember: {
      findUnique: async () => null,
    },
  };

  const { createCallerFactory } = await import("../init");
  const { agentRouter } = await import("./agent");
  const caller = createCallerFactory(agentRouter)({
    prisma: prisma as never,
    sessionUserId: "user-1",
  });

  await assert.rejects(
    () =>
      caller.getFixPRStatus({
        threadId: "thread-1",
        workspaceId: "workspace-1",
        userId: "user-1",
      }),
    (error: unknown) =>
      error instanceof TRPCError &&
      error.code === "FORBIDDEN" &&
      error.message === "Not a member of this workspace",
  );
});
