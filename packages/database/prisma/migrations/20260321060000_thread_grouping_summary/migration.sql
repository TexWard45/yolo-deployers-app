-- AlterTable
ALTER TABLE "SupportThread"
ADD COLUMN "issueFingerprint" TEXT,
ADD COLUMN "lastInboundAt" TIMESTAMP(3),
ADD COLUMN "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN "summary" TEXT,
ADD COLUMN "summaryUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ThreadMessage"
ADD COLUMN "inReplyToExternalMessageId" TEXT,
ADD COLUMN "messageFingerprint" TEXT,
ADD COLUMN "senderExternalId" TEXT;

-- CreateIndex
CREATE INDEX "SupportThread_workspaceId_customerId_status_lastMessageAt_idx"
ON "SupportThread"("workspaceId", "customerId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportThread_workspaceId_customerId_issueFingerprint_idx"
ON "SupportThread"("workspaceId", "customerId", "issueFingerprint");

-- CreateIndex
CREATE INDEX "ThreadMessage_threadId_inReplyToExternalMessageId_idx"
ON "ThreadMessage"("threadId", "inReplyToExternalMessageId");

-- CreateIndex
CREATE INDEX "ThreadMessage_externalMessageId_idx"
ON "ThreadMessage"("externalMessageId");
