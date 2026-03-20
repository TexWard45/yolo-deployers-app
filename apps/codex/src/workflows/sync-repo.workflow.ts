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
  syncLogId: string;
}

// Short-lived activities (DB reads/writes, status updates)
const {
  updateSyncStatus,
  createSyncLog,
  cleanupDeletedFiles,
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

/**
 * Full sync pipeline: clone/pull → list files → cleanup → parse fan-out → log.
 *
 * For initial clones: all files are parsed.
 * For incremental pulls: only changed files are parsed, deleted files are cleaned up.
 * Embedding of PENDING chunks is deferred to Phase 4.
 */
export async function syncRepoWorkflow(
  input: SyncRepoInput,
): Promise<SyncRepoResult> {
  const { repositoryId } = input;

  // Mark repository as syncing
  await updateSyncStatus({ repositoryId, status: "SYNCING" });

  let previousCommit: string | null = null;

  try {
    // Step 1: Clone or pull the repository
    const cloneResult = await cloneRepository({ repositoryId });
    previousCommit = cloneResult.previousCommit;

    const isFullSync = cloneResult.changedFiles === null;

    // Step 2: Determine which files to process
    let filesToProcess: string[];
    let deletedFiles: string[] = [];

    if (isFullSync) {
      // Initial clone — process all files
      filesToProcess = await listRepositoryFiles({
        localPath: cloneResult.localPath,
      });
    } else {
      // Incremental pull — only process changed files
      filesToProcess = cloneResult.changedFiles!;

      // Identify deleted files (present in changedFiles but missing on disk)
      // The git diff includes all changed/added/deleted files.
      // We parse what exists; listRepositoryFiles for deleted detection isn't needed
      // since git diff already tells us which files changed. Files that were deleted
      // will fail to read in the parse activity and be skipped.
      // However, we should explicitly clean up DB records for deleted files.
      const allCurrentFiles = await listRepositoryFiles({
        localPath: cloneResult.localPath,
      });
      const currentFileSet = new Set(allCurrentFiles);
      deletedFiles = filesToProcess.filter((f) => !currentFileSet.has(f));
      filesToProcess = filesToProcess.filter((f) => currentFileSet.has(f));
    }

    // Step 3: Cleanup deleted files
    let totalChunksDeleted = 0;
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
    }

    // Step 5: Update repository status
    await updateSyncStatus({
      repositoryId,
      status: "COMPLETED",
      lastSyncCommit: cloneResult.headCommit,
      lastSyncError: null,
    });

    // Step 6: Create sync log
    const syncLogId = await createSyncLog({
      repositoryId,
      status: "COMPLETED",
      commitBefore: previousCommit,
      commitAfter: cloneResult.headCommit,
      filesChanged: filesProcessed,
      chunksCreated: totalChunksCreated,
      chunksUpdated: totalChunksUpdated,
      chunksDeleted: totalChunksDeleted,
    });

    return {
      headCommit: cloneResult.headCommit,
      filesProcessed,
      chunksCreated: totalChunksCreated,
      chunksUpdated: totalChunksUpdated,
      chunksDeleted: totalChunksDeleted,
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

    // Log the failure
    await createSyncLog({
      repositoryId,
      status: "FAILED",
      commitBefore: previousCommit,
      commitAfter: null,
      filesChanged: 0,
      chunksCreated: 0,
      chunksUpdated: 0,
      chunksDeleted: 0,
      errorMessage,
    });

    throw error;
  }
}
