-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "CodexSourceType" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'LOCAL_GIT', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "CodexSyncMode" AS ENUM ('WEBHOOK', 'CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "CodexSyncStatus" AS ENUM ('IDLE', 'SYNCING', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CodexChunkType" AS ENUM ('FUNCTION', 'METHOD', 'CLASS', 'TYPE', 'INTERFACE', 'ENUM', 'ROUTE_HANDLER', 'MODULE', 'FRAGMENT');

-- CreateEnum
CREATE TYPE "CodexEmbeddingStatus" AS ENUM ('PENDING', 'EMBEDDED', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "CodexSymbolRefKind" AS ENUM ('CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS');

-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('DISCORD', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('NEW', 'WAITING_REVIEW', 'WAITING_CUSTOMER', 'ESCALATED', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateTable
CREATE TABLE "CodexRepository" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceType" "CodexSourceType" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "credentials" JSONB,
    "syncMode" "CodexSyncMode" NOT NULL DEFAULT 'MANUAL',
    "cronExpression" TEXT,
    "syncStatus" "CodexSyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncCommit" TEXT,
    "lastSyncError" TEXT,
    "extensionAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pathDenylist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxFileSizeBytes" INTEGER NOT NULL DEFAULT 1048576,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodexRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodexSyncLog" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" "CodexSyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "commitBefore" TEXT,
    "commitAfter" TEXT,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "chunksCreated" INTEGER NOT NULL DEFAULT 0,
    "chunksUpdated" INTEGER NOT NULL DEFAULT 0,
    "chunksDeleted" INTEGER NOT NULL DEFAULT 0,
    "embeddingsGen" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "CodexSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodexFile" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "lastCommitSha" TEXT,
    "lastCommitAt" TIMESTAMP(3),
    "lastAuthor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodexFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodexChunk" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "chunkType" "CodexChunkType" NOT NULL,
    "symbolName" TEXT,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "parameters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "returnType" TEXT,
    "imports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exportType" TEXT,
    "isAsync" BOOLEAN NOT NULL DEFAULT false,
    "docstring" TEXT,
    "parentChunkId" TEXT,
    "embedding" vector(1536),
    "embeddingStatus" "CodexEmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "embeddingModelId" TEXT,
    "embeddedAt" TIMESTAMP(3),
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodexChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodexSymbolRef" (
    "id" TEXT NOT NULL,
    "sourceChunkId" TEXT NOT NULL,
    "targetChunkId" TEXT NOT NULL,
    "kind" "CodexSymbolRefKind" NOT NULL,
    "line" INTEGER,

    CONSTRAINT "CodexSymbolRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "CustomerSource" NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" "CustomerSource" NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "title" TEXT,
    "status" "ThreadStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CodexRepository_workspaceId_idx" ON "CodexRepository"("workspaceId");

-- CreateIndex
CREATE INDEX "CodexRepository_sourceType_idx" ON "CodexRepository"("sourceType");

-- CreateIndex
CREATE INDEX "CodexSyncLog_repositoryId_idx" ON "CodexSyncLog"("repositoryId");

-- CreateIndex
CREATE INDEX "CodexFile_repositoryId_idx" ON "CodexFile"("repositoryId");

-- CreateIndex
CREATE INDEX "CodexFile_language_idx" ON "CodexFile"("language");

-- CreateIndex
CREATE UNIQUE INDEX "CodexFile_repositoryId_filePath_key" ON "CodexFile"("repositoryId", "filePath");

-- CreateIndex
CREATE INDEX "CodexChunk_fileId_idx" ON "CodexChunk"("fileId");

-- CreateIndex
CREATE INDEX "CodexChunk_chunkType_idx" ON "CodexChunk"("chunkType");

-- CreateIndex
CREATE INDEX "CodexChunk_symbolName_idx" ON "CodexChunk"("symbolName");

-- CreateIndex
CREATE INDEX "CodexChunk_contentHash_idx" ON "CodexChunk"("contentHash");

-- CreateIndex
CREATE INDEX "CodexSymbolRef_sourceChunkId_idx" ON "CodexSymbolRef"("sourceChunkId");

-- CreateIndex
CREATE INDEX "CodexSymbolRef_targetChunkId_idx" ON "CodexSymbolRef"("targetChunkId");

-- CreateIndex
CREATE UNIQUE INDEX "CodexSymbolRef_sourceChunkId_targetChunkId_kind_key" ON "CodexSymbolRef"("sourceChunkId", "targetChunkId", "kind");

-- CreateIndex
CREATE INDEX "Customer_workspaceId_createdAt_idx" ON "Customer"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_workspaceId_source_externalCustomerId_key" ON "Customer"("workspaceId", "source", "externalCustomerId");

-- CreateIndex
CREATE INDEX "SupportThread_workspaceId_status_updatedAt_idx" ON "SupportThread"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportThread_customerId_createdAt_idx" ON "SupportThread"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportThread_workspaceId_source_externalThreadId_key" ON "SupportThread"("workspaceId", "source", "externalThreadId");

-- CreateIndex
CREATE INDEX "ThreadMessage_threadId_createdAt_idx" ON "ThreadMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadMessage_threadId_externalMessageId_key" ON "ThreadMessage"("threadId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_userId_workspaceId_key" ON "WorkspaceMember"("userId", "workspaceId");

-- AddForeignKey
ALTER TABLE "CodexRepository" ADD CONSTRAINT "CodexRepository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexSyncLog" ADD CONSTRAINT "CodexSyncLog_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CodexRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexFile" ADD CONSTRAINT "CodexFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "CodexRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexChunk" ADD CONSTRAINT "CodexChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CodexFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexChunk" ADD CONSTRAINT "CodexChunk_parentChunkId_fkey" FOREIGN KEY ("parentChunkId") REFERENCES "CodexChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexSymbolRef" ADD CONSTRAINT "CodexSymbolRef_sourceChunkId_fkey" FOREIGN KEY ("sourceChunkId") REFERENCES "CodexChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexSymbolRef" ADD CONSTRAINT "CodexSymbolRef_targetChunkId_fkey" FOREIGN KEY ("targetChunkId") REFERENCES "CodexChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadMessage" ADD CONSTRAINT "ThreadMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IVFFlat index for vector similarity search
CREATE INDEX idx_codex_chunk_embedding ON "CodexChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- GIN index for full-text search
CREATE INDEX idx_codex_chunk_search_vector ON "CodexChunk" USING gin ("searchVector");
