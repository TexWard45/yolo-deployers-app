import type { CodexSourceType } from "@shared/types";

export interface CloneResult {
  localPath: string;
  headCommit: string;
  branch: string;
}

export interface PullResult {
  headCommit: string;
  previousCommit: string;
  changedFiles: string[];
  branch: string;
}

export interface ISourceAdapter {
  readonly sourceType: CodexSourceType;

  /**
   * Clone the repository to a local path.
   * Returns the local path and the HEAD commit SHA.
   */
  clone(opts: {
    sourceUrl: string;
    branch: string;
    targetPath: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<CloneResult>;

  /**
   * Pull latest changes for an already-cloned repository.
   * Returns the new HEAD commit and list of changed files since the previous commit.
   */
  pull(opts: {
    localPath: string;
    branch: string;
    previousCommit: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<PullResult>;
}
