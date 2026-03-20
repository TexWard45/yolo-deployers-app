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
  await prisma.codexRepository.update({
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
      completedAt: new Date(),
      errorMessage: input.errorMessage,
    },
  });
  return log.id;
}
