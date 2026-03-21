import { prisma } from "@shared/database";
import type { CodexSyncStatus } from "@shared/types";

export interface UpdateSyncStatusInput {
  repositoryId: string;
  status: CodexSyncStatus;
  lastSyncCommit?: string;
  lastSyncError?: string | null;
}

/**
 * Update the repository's sync status (IDLE, SYNCING, FAILED, COMPLETED).
 */
export async function updateSyncStatus(
  input: UpdateSyncStatusInput,
): Promise<void> {
  const result = await prisma.codexRepository.updateMany({
    where: { id: input.repositoryId },
    data: {
      syncStatus: input.status,
      ...(input.lastSyncCommit != null && {
        lastSyncCommit: input.lastSyncCommit,
        lastSyncAt: new Date(),
      }),
      ...(input.lastSyncError !== undefined && {
        lastSyncError: input.lastSyncError,
      }),
    },
  });

  if (result.count === 0) {
    console.warn(
      `updateSyncStatus: repository ${input.repositoryId} not found — it may have been deleted`,
    );
  }
}

export interface CreateSyncLogInput {
  repositoryId: string;
  status: CodexSyncStatus;
  commitBefore: string | null;
  commitAfter: string | null;
  filesChanged: number;
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeleted: number;
  embeddingsGenerated?: number;
  errorMessage?: string | null;
}

/**
 * Create a CodexSyncLog entry with metrics from the completed sync.
 */
export async function createSyncLog(
  input: CreateSyncLogInput,
): Promise<string> {
  const log = await prisma.codexSyncLog.create({
    data: {
      repositoryId: input.repositoryId,
      status: input.status,
      commitBefore: input.commitBefore,
      commitAfter: input.commitAfter,
      filesChanged: input.filesChanged,
      chunksCreated: input.chunksCreated,
      chunksUpdated: input.chunksUpdated,
      chunksDeleted: input.chunksDeleted,
      embeddingsGen: input.embeddingsGenerated ?? 0,
      completedAt: input.status === "SYNCING" ? null : new Date(),
      errorMessage: input.errorMessage,
    },
  });
  return log.id;
}

export interface UpdateSyncLogInput {
  syncLogId: string;
  status?: CodexSyncStatus;
  commitAfter?: string | null;
  filesChanged?: number;
  chunksCreated?: number;
  chunksUpdated?: number;
  chunksDeleted?: number;
  embeddingsGenerated?: number;
  errorMessage?: string | null;
}

/**
 * Update an existing sync log with progress or final metrics.
 */
export async function updateSyncLog(
  input: UpdateSyncLogInput,
): Promise<void> {
  const isTerminal = input.status === "COMPLETED" || input.status === "FAILED";
  const result = await prisma.codexSyncLog.updateMany({
    where: { id: input.syncLogId },
    data: {
      ...(input.status != null && { status: input.status }),
      ...(input.commitAfter !== undefined && { commitAfter: input.commitAfter }),
      ...(input.filesChanged != null && { filesChanged: input.filesChanged }),
      ...(input.chunksCreated != null && { chunksCreated: input.chunksCreated }),
      ...(input.chunksUpdated != null && { chunksUpdated: input.chunksUpdated }),
      ...(input.chunksDeleted != null && { chunksDeleted: input.chunksDeleted }),
      ...(input.embeddingsGenerated != null && { embeddingsGen: input.embeddingsGenerated }),
      ...(input.errorMessage !== undefined && { errorMessage: input.errorMessage }),
      ...(isTerminal && { completedAt: new Date() }),
    },
  });

  if (result.count === 0) {
    console.warn(
      `updateSyncLog: sync log ${input.syncLogId} not found — it may have been deleted via cascade`,
    );
  }
}
