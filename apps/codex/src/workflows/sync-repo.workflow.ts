import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

export interface SyncRepoInput {
  repositoryId: string;
}

export interface SyncRepoResult {
  headCommit: string;
  filesProcessed: number;
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeleted: number;
  embeddingsGenerated: number;
  embeddingsFailed: number;
  syncLogId: string;
}

// Short-lived activities (DB reads/writes, status updates)
const {
  updateSyncStatus,
  createSyncLog,
  updateSyncLog,
  cleanupDeletedFiles,
  cleanupStaleFiles,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
});

// Clone/pull can take longer for large repos
const { cloneRepository } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

// File listing — medium timeout
const { listRepositoryFiles } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
});

// Parsing individual files — allow reasonable time per file
const { parseFileActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "2 seconds",
  },
});

// Embedding — can take a while for large repos due to API rate limits
const { embedChunksActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

/**
 * Full sync pipeline: clone/pull → list files → cleanup → parse fan-out → embed → log.
 *
 * For initial clones: all files are parsed.
 * For incremental pulls: only changed files are parsed, deleted files are cleaned up.
 * After parsing, all PENDING chunks are embedded via the OpenAI embedding API.
 */
export async function syncRepoWorkflow(
  input: SyncRepoInput,
): Promise<SyncRepoResult> {
  const { repositoryId } = input;

  // Mark repository as syncing
  await updateSyncStatus({ repositoryId, status: "SYNCING" });

  // Create sync log upfront so progress is visible in the UI
  const syncLogId = await createSyncLog({
    repositoryId,
    status: "SYNCING",
    commitBefore: null,
    commitAfter: null,
    filesChanged: 0,
    chunksCreated: 0,
    chunksUpdated: 0,
    chunksDeleted: 0,
  });

  try {
    // Step 1: Clone or pull the repository
    const cloneResult = await cloneRepository({ repositoryId });

    const isFullSync = cloneResult.changedFiles === null;

    // Update log with commit info
    await updateSyncLog({
      syncLogId,
      commitAfter: cloneResult.headCommit,
    });

    // Step 2: Determine which files to process
    let filesToProcess: string[];
    let deletedFiles: string[] = [];
    let totalChunksDeleted = 0;

    if (isFullSync) {
      // Initial clone — process all files
      filesToProcess = await listRepositoryFiles({
        localPath: cloneResult.localPath,
      });

      // Clean up stale CodexFile records not in the current file set
      const staleCleanup = await cleanupStaleFiles({
        repositoryId,
        currentFilePaths: filesToProcess,
      });
      totalChunksDeleted += staleCleanup.chunksDeleted;
    } else {
      // Incremental pull — only process changed files
      filesToProcess = cloneResult.changedFiles!;

      // Identify deleted files (present in changedFiles but missing on disk)
      const allCurrentFiles = await listRepositoryFiles({
        localPath: cloneResult.localPath,
      });
      const currentFileSet = new Set(allCurrentFiles);
      deletedFiles = filesToProcess.filter((f) => !currentFileSet.has(f));
      filesToProcess = filesToProcess.filter((f) => currentFileSet.has(f));
    }

    // Step 3: Cleanup deleted files
    if (deletedFiles.length > 0) {
      const cleanupResult = await cleanupDeletedFiles({
        repositoryId,
        deletedFilePaths: deletedFiles,
      });
      totalChunksDeleted += cleanupResult.chunksDeleted;
    }

    // Step 4: Parse files (fan-out, sequential to avoid overwhelming DB)
    let totalChunksCreated = 0;
    let totalChunksUpdated = 0;
    let filesProcessed = 0;

    // Process files in batches to balance throughput and resource usage
    const BATCH_SIZE = 10;
    for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
      const batch = filesToProcess.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map((filePath) =>
          parseFileActivity({
            repositoryId,
            localPath: cloneResult.localPath,
            filePath,
            headCommit: cloneResult.headCommit,
          }),
        ),
      );

      for (const result of results) {
        if (!result.skipped) {
          filesProcessed++;
        }
        totalChunksCreated += result.chunksCreated;
        totalChunksUpdated += result.chunksUpdated;
        totalChunksDeleted += result.chunksDeleted;
      }

      // Update log after each batch so progress is visible
      await updateSyncLog({
        syncLogId,
        filesChanged: filesProcessed,
        chunksCreated: totalChunksCreated,
        chunksUpdated: totalChunksUpdated,
        chunksDeleted: totalChunksDeleted,
      });
    }

    // Step 5: Embed PENDING chunks
    const embedResult = await embedChunksActivity({ repositoryId });

    // Step 6: Update repository status
    await updateSyncStatus({
      repositoryId,
      status: "COMPLETED",
      lastSyncCommit: cloneResult.headCommit,
      lastSyncError: null,
    });

    // Step 7: Finalize sync log
    await updateSyncLog({
      syncLogId,
      status: "COMPLETED",
      commitAfter: cloneResult.headCommit,
      filesChanged: filesProcessed,
      chunksCreated: totalChunksCreated,
      chunksUpdated: totalChunksUpdated,
      chunksDeleted: totalChunksDeleted,
      embeddingsGenerated: embedResult.embeddingsGenerated,
    });

    return {
      headCommit: cloneResult.headCommit,
      filesProcessed,
      chunksCreated: totalChunksCreated,
      chunksUpdated: totalChunksUpdated,
      chunksDeleted: totalChunksDeleted,
      embeddingsGenerated: embedResult.embeddingsGenerated,
      embeddingsFailed: embedResult.embeddingsFailed,
      syncLogId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Mark as failed
    await updateSyncStatus({
      repositoryId,
      status: "FAILED",
      lastSyncError: errorMessage,
    });

    // Update sync log with failure
    await updateSyncLog({
      syncLogId,
      status: "FAILED",
      errorMessage,
    });

    throw error;
  }
}
