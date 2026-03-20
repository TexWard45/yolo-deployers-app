import type { CodexSourceType } from "@shared/types";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class GitLabAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "GITLAB";

  clone(): Promise<CloneResult> {
    throw new Error("GitLab adapter not implemented");
  }

  pull(): Promise<PullResult> {
    throw new Error("GitLab adapter not implemented");
  }
}
