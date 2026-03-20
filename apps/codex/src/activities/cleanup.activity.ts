import { prisma } from "@shared/database";

export interface CleanupInput {
  repositoryId: string;
  deletedFilePaths: string[];
}

export interface CleanupResult {
  filesDeleted: number;
  chunksDeleted: number;
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
