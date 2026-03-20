import type { CodexSourceType } from "@shared/types";
import type { ISourceAdapter } from "./types.js";
import { GitHubAdapter } from "./github.adapter.js";
import { LocalGitAdapter } from "./local-git.adapter.js";
import { GitLabAdapter } from "./gitlab.adapter.js";
import { BitbucketAdapter } from "./bitbucket.adapter.js";
import { AzureDevOpsAdapter } from "./azure-devops.adapter.js";
import { ArchiveAdapter } from "./archive.adapter.js";

const adapters: Record<CodexSourceType, () => ISourceAdapter> = {
  GITHUB: () => new GitHubAdapter(),
  LOCAL_GIT: () => new LocalGitAdapter(),
  GITLAB: () => new GitLabAdapter(),
  BITBUCKET: () => new BitbucketAdapter(),
  AZURE_DEVOPS: () => new AzureDevOpsAdapter(),
  ARCHIVE: () => new ArchiveAdapter(),
};

export function getAdapter(sourceType: CodexSourceType): ISourceAdapter {
  const factory = adapters[sourceType];
  if (!factory) {
    throw new Error(`No adapter for source type: ${sourceType}`);
  }
  return factory();
}
