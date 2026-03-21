import type { CodexSourceType } from "@shared/types";
import { GitAdapter } from "./git.adapter.js";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class BitbucketAdapter extends GitAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "BITBUCKET";

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

    const username = credentials["username"] as string | undefined;
    const appPassword = credentials["appPassword"] as string | undefined;
    if (!username || !appPassword) return sourceUrl;

    // Bitbucket app password auth: https://<username>:<app-password>@bitbucket.org/owner/repo
    const url = new URL(sourceUrl);
    url.username = username;
    url.password = appPassword;
    return url.toString();
  }
}
