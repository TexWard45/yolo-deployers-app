import type { CodexSourceType } from "@shared/types";
import { GitAdapter } from "./git.adapter.js";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class GitLabAdapter extends GitAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "GITLAB";

  async clone(opts: {
    sourceUrl: string;
    branch: string;
    targetPath: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<CloneResult> {
    const remoteUrl = this.buildAuthUrl(opts.sourceUrl, opts.credentials);
    return this.cloneRepo({
      remoteUrl,
      branch: opts.branch,
      targetPath: opts.targetPath,
    });
  }

  async pull(opts: {
    localPath: string;
    branch: string;
    previousCommit: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<PullResult> {
    return this.pullRepo({
      localPath: opts.localPath,
      branch: opts.branch,
      previousCommit: opts.previousCommit,
    });
  }

  private buildAuthUrl(
    sourceUrl: string,
    credentials?: Record<string, unknown> | null
  ): string {
    if (!credentials) return sourceUrl;

    const token = credentials["token"] as string | undefined;
    if (!token) return sourceUrl;

    // GitLab PAT auth: https://oauth2:<token>@gitlab.com/owner/repo
    const url = new URL(sourceUrl);
    url.username = "oauth2";
    url.password = token;
    return url.toString();
  }
}
