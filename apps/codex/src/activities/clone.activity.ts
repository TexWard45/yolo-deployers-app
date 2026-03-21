import { join } from "node:path";
import { existsSync } from "node:fs";
import { prisma } from "@shared/database";
import type { CodexSourceType } from "@shared/types";
import { codexConfig } from "../config.js";
import { getAdapter } from "../adapters/factory.js";
import type { CloneResult, PullResult } from "../adapters/types.js";

export interface CloneActivityInput {
  repositoryId: string;
}

export interface CloneActivityResult {
  localPath: string;
  headCommit: string;
  previousCommit: string | null;
  changedFiles: string[] | null; // null = full sync (initial clone)
  branch: string;
}

/**
 * Clone or pull a repository via the appropriate source adapter.
 * Returns clone/pull metadata so the workflow can decide how to proceed.
 */
export async function cloneRepository(
  input: CloneActivityInput,
): Promise<CloneActivityResult> {
  const repo = await prisma.codexRepository.findUniqueOrThrow({
    where: { id: input.repositoryId },
  });

  const adapter = getAdapter(repo.sourceType as CodexSourceType);
  const targetPath = join(codexConfig.cloneBasePath, repo.id);
  const isIncremental = existsSync(targetPath) && repo.lastSyncCommit != null;

  if (isIncremental) {
    // Incremental pull
    const pullResult: PullResult = await adapter.pull({
      localPath: targetPath,
      branch: repo.defaultBranch,
      previousCommit: repo.lastSyncCommit!,
      credentials: repo.credentials as Record<string, unknown> | null,
    });

    return {
      localPath: targetPath,
      headCommit: pullResult.headCommit,
      previousCommit: pullResult.previousCommit,
      changedFiles: pullResult.changedFiles,
      branch: pullResult.branch,
    };
  }

  // Initial clone
  const cloneResult: CloneResult = await adapter.clone({
    sourceUrl: repo.sourceUrl,
    branch: repo.defaultBranch,
    targetPath,
    credentials: repo.credentials as Record<string, unknown> | null,
  });

  return {
    localPath: cloneResult.localPath,
    headCommit: cloneResult.headCommit,
    previousCommit: null,
    changedFiles: null, // null signals full sync
    branch: cloneResult.branch,
  };
}
