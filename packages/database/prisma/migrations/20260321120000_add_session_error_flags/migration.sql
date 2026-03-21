-- AlterTable
ALTER TABLE "Session" ADD COLUMN "hasError" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "errorCount" INTEGER NOT NULL DEFAULT 0;

-- Partial index: only indexes sessions that have errors, keeping the index small
-- while making WHERE "hasError" = true queries fast as the table grows.
CREATE INDEX "Session_hasError_idx" ON "Session"("hasError") WHERE "hasError" = true;
