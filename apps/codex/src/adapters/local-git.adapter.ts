import type { CodexSourceType } from "@shared/types";
import { GitAdapter } from "./git.adapter.js";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class LocalGitAdapter extends GitAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "LOCAL_GIT";

  async clone(opts: {
    sourceUrl: string;
    branch: string;
    targetPath: string;
  }): Promise<CloneResult> {
    // sourceUrl is the local path to the repo — clone from filesystem
    return this.cloneRepo({
      remoteUrl: opts.sourceUrl,
      branch: opts.branch,
      targetPath: opts.targetPath,
    });
  }

  async pull(opts: {
    localPath: string;
    branch: string;
    previousCommit: string;
  }): Promise<PullResult> {
    return this.pullRepo({
      localPath: opts.localPath,
      branch: opts.branch,
      previousCommit: opts.previousCommit,
    });
  }
}
