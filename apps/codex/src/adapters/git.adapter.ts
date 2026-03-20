import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { CloneResult, PullResult } from "./types.js";

/**
 * Shared base logic for Git-based adapters (GitHub, GitLab, Bitbucket, local).
 * Subclasses provide the authenticated remote URL.
 */
export abstract class GitAdapter {
  protected createGit(baseDir?: string): SimpleGit {
    if (baseDir) {
      return simpleGit({ baseDir });
    }
    return simpleGit();
  }

  protected async cloneRepo(opts: {
    remoteUrl: string;
    branch: string;
    targetPath: string;
  }): Promise<CloneResult> {
    const git = this.createGit();

    // Ensure the parent directory exists before cloning
    await mkdir(dirname(opts.targetPath), { recursive: true });

    await git.clone(opts.remoteUrl, opts.targetPath, [
      "--branch",
      opts.branch,
      "--single-branch",
      "--depth",
      "1",
    ]);

    const repoGit = this.createGit(opts.targetPath);
    const log = await repoGit.log({ maxCount: 1 });

    return {
      localPath: opts.targetPath,
      headCommit: log.latest?.hash ?? "unknown",
      branch: opts.branch,
    };
  }

  protected async pullRepo(opts: {
    localPath: string;
    branch: string;
    previousCommit: string;
  }): Promise<PullResult> {
    const git = this.createGit(opts.localPath);

    // Fetch and reset to get full history for diffing
    await git.fetch(["origin", opts.branch]);
    await git.reset(["--hard", `origin/${opts.branch}`]);

    const log = await git.log({ maxCount: 1 });
    const headCommit = log.latest?.hash ?? "unknown";

    // Get changed files between previous and current commit
    let changedFiles: string[] = [];
    if (opts.previousCommit && opts.previousCommit !== headCommit) {
      const diff = await git.diffSummary([opts.previousCommit, headCommit]);
      changedFiles = diff.files.map((f) => f.file);
    }

    return {
      headCommit,
      previousCommit: opts.previousCommit,
      changedFiles,
      branch: opts.branch,
    };
  }
}
