import type { CodexSourceType } from "@shared/types";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class ArchiveAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "ARCHIVE";

  clone(): Promise<CloneResult> {
    throw new Error("Archive adapter not implemented");
  }

  pull(): Promise<PullResult> {
    throw new Error("Archive adapter not implemented");
  }
}
