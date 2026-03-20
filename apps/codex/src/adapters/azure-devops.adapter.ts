import type { CodexSourceType } from "@shared/types";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class AzureDevOpsAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "AZURE_DEVOPS";

  clone(): Promise<CloneResult> {
    throw new Error("Azure DevOps adapter not implemented");
  }

  pull(): Promise<PullResult> {
    throw new Error("Azure DevOps adapter not implemented");
  }
}
