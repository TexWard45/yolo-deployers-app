-- AlterTable
ALTER TABLE "ReplayEvent" ADD COLUMN     "route" TEXT,
ADD COLUMN     "traceId" TEXT;

-- CreateTable
CREATE TABLE "SessionClick" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "selector" TEXT,
    "tagName" TEXT,
    "text" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "traceId" TEXT,
    "route" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTraceLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTraceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionClick_sessionId_timestamp_idx" ON "SessionClick"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "SessionClick_traceId_idx" ON "SessionClick"("traceId");

-- CreateIndex
CREATE INDEX "SessionTraceLink_traceId_idx" ON "SessionTraceLink"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTraceLink_sessionId_traceId_key" ON "SessionTraceLink"("sessionId", "traceId");

-- CreateIndex
CREATE INDEX "ReplayEvent_traceId_idx" ON "ReplayEvent"("traceId");

-- AddForeignKey
ALTER TABLE "SessionClick" ADD CONSTRAINT "SessionClick_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTraceLink" ADD CONSTRAINT "SessionTraceLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
