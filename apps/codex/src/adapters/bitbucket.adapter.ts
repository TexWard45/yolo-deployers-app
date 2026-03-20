import type { CodexSourceType } from "@shared/types";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class BitbucketAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "BITBUCKET";

  clone(): Promise<CloneResult> {
    throw new Error("Bitbucket adapter not implemented");
  }

  pull(): Promise<PullResult> {
    throw new Error("Bitbucket adapter not implemented");
  }
}
