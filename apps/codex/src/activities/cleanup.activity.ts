import { prisma } from "@shared/database";

export interface CleanupInput {
  repositoryId: string;
  deletedFilePaths: string[];
}

export interface CleanupResult {
  filesDeleted: number;
  chunksDeleted: number;
}

export interface CleanupStaleFilesInput {
  repositoryId: string;
  currentFilePaths: string[];
}

export interface CleanupStaleFilesResult {
  filesDeleted: number;
  chunksDeleted: number;
}

/**
 * Remove CodexFile records that are no longer in the current file set.
 * Used during full syncs to purge stale records from previous indexing runs
 * (e.g., files that were indexed under old code but are now skipped,
 * or files deleted from the repository).
 */
export async function cleanupStaleFiles(
  input: CleanupStaleFilesInput,
): Promise<CleanupStaleFilesResult> {
  const { repositoryId, currentFilePaths } = input;

  const currentSet = new Set(currentFilePaths);

  // Get all indexed files for this repository
  const indexedFiles = await prisma.codexFile.findMany({
    where: { repositoryId },
    select: { filePath: true },
  });

  const stalePaths = indexedFiles
    .map((f) => f.filePath)
    .filter((p) => !currentSet.has(p));

  if (stalePaths.length === 0) {
    return { filesDeleted: 0, chunksDeleted: 0 };
  }

  // Count chunks that will be cascade-deleted
  const chunkCount = await prisma.codexChunk.count({
    where: {
      file: {
        repositoryId,
        filePath: { in: stalePaths },
      },
    },
  });

  const deleteResult = await prisma.codexFile.deleteMany({
    where: {
      repositoryId,
      filePath: { in: stalePaths },
    },
  });

  return {
    filesDeleted: deleteResult.count,
    chunksDeleted: chunkCount,
  };
}

/**
 * Delete CodexFile rows (and cascade-delete their CodexChunk rows)
 * for files that no longer exist in the repository after a pull.
 */
export async function cleanupDeletedFiles(
  input: CleanupInput,
): Promise<CleanupResult> {
  const { repositoryId, deletedFilePaths } = input;

  if (deletedFilePaths.length === 0) {
    return { filesDeleted: 0, chunksDeleted: 0 };
  }

  // Count chunks that will be cascade-deleted
  const chunkCount = await prisma.codexChunk.count({
    where: {
      file: {
        repositoryId,
        filePath: { in: deletedFilePaths },
      },
    },
  });

  // Delete files — chunks cascade via onDelete: Cascade
  const deleteResult = await prisma.codexFile.deleteMany({
    where: {
      repositoryId,
      filePath: { in: deletedFilePaths },
    },
  });

  return {
    filesDeleted: deleteResult.count,
    chunksDeleted: chunkCount,
  };
}
