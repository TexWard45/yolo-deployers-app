-- Add fix PR run loop support. This migration is intentionally defensive because
-- support-domain tables in this repo have existing schema drift outside migrate history.

DO $$
BEGIN
    CREATE TYPE "FixPrRunStatus" AS ENUM (
        'QUEUED',
        'RUNNING',
        'WAITING_REVIEW',
        'PASSED',
        'FAILED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "FixPrIterationStatus" AS ENUM (
        'QUEUED',
        'RUNNING',
        'PASSED',
        'FAILED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "TriageActionType" ADD VALUE IF NOT EXISTS 'GENERATE_FIX_PR';

ALTER TABLE "WorkspaceAgentConfig"
    ADD COLUMN IF NOT EXISTS "githubToken" TEXT,
    ADD COLUMN IF NOT EXISTS "githubDefaultOwner" TEXT,
    ADD COLUMN IF NOT EXISTS "githubDefaultRepo" TEXT,
    ADD COLUMN IF NOT EXISTS "githubBaseBranch" TEXT DEFAULT 'main',
    ADD COLUMN IF NOT EXISTS "codexFixModel" TEXT,
    ADD COLUMN IF NOT EXISTS "codexReviewModel" TEXT,
    ADD COLUMN IF NOT EXISTS "codexFixMaxIterations" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS "codexRequiredCheckNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "FixPrRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "FixPrRunStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT NOT NULL DEFAULT 'QUEUED',
    "parentThreadId" TEXT,
    "prUrl" TEXT,
    "prNumber" INTEGER,
    "branchName" TEXT,
    "headSha" TEXT,
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "maxIterations" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "summary" TEXT,
    "rcaSummary" TEXT,
    "rcaConfidence" DOUBLE PRECISION,
    "rcaSignals" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixPrRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FixPrIteration" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "status" "FixPrIterationStatus" NOT NULL DEFAULT 'QUEUED',
    "fixPlan" JSONB,
    "reviewFindings" JSONB,
    "checkResults" JSONB,
    "appliedFiles" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixPrIteration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FixPrRun_analysisId_key"
ON "FixPrRun"("analysisId");

CREATE INDEX IF NOT EXISTS "FixPrRun_workspaceId_createdAt_idx"
ON "FixPrRun"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "FixPrRun_threadId_idx"
ON "FixPrRun"("threadId");

CREATE UNIQUE INDEX IF NOT EXISTS "FixPrIteration_runId_iteration_key"
ON "FixPrIteration"("runId", "iteration");

CREATE INDEX IF NOT EXISTS "FixPrIteration_runId_createdAt_idx"
ON "FixPrIteration"("runId", "createdAt");

DO $$
BEGIN
    ALTER TABLE "FixPrRun"
        ADD CONSTRAINT "FixPrRun_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FixPrRun"
        ADD CONSTRAINT "FixPrRun_threadId_fkey"
        FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FixPrRun"
        ADD CONSTRAINT "FixPrRun_analysisId_fkey"
        FOREIGN KEY ("analysisId") REFERENCES "ThreadAnalysis"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FixPrRun"
        ADD CONSTRAINT "FixPrRun_createdById_fkey"
        FOREIGN KEY ("createdById") REFERENCES "User"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "FixPrIteration"
        ADD CONSTRAINT "FixPrIteration_runId_fkey"
        FOREIGN KEY ("runId") REFERENCES "FixPrRun"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
