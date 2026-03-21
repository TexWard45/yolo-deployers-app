import { promisify } from "node:util";
import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { existsSync, readdirSync, lstatSync, type Dirent } from "node:fs";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prisma } from "@shared/database";
import {
  buildFixPrTestPlan,
  expandFixPrCodeContext,
  createDraftPullRequest,
  createGitHubClient,
  generateCodexFix,
  generateFixPrRca,
  reviewCodexFix,
} from "@shared/rest";
import type {
  FixPrChecksOutput,
  FixPrCodeContextOutput,
  FixPrFixerOutput,
  FixPrRcaOutput,
  FixPrReviewerOutput,
  FixPrTestPlan,
  GenerateFixPRWorkflowInput,
  SaveFixPRProgressInput,
} from "@shared/types";
import { codexConfig } from "../config.js";

const FIX_PR_DEBUG_LOGS =
  process.env.CODEX_FIX_DEBUG_LOGS === "1"
  || process.env.CODEX_FIX_DEBUG_LOGS?.toLowerCase() === "true"
  || process.env.CODEX_DEBUG_LOGS === "1"
  || process.env.CODEX_DEBUG_LOGS?.toLowerCase() === "true";

function debugLog(message: string, ...rest: unknown[]) {
  if (!FIX_PR_DEBUG_LOGS) return;
  console.log(`[fix-pr][activity] ${message}`, ...rest);
}

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
const codexCloneBasePath = path.resolve(codexConfig.cloneBasePath);
// Commands and file edits operate on repo-relative paths, so activities anchor
// all filesystem work at the monorepo root instead of the app package directory.
export const repoRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export interface FixRunContext {
  runId: string;
  workspaceId: string;
  threadId: string;
  analysisId: string;
  summary: string;
  rcaSummary: string | null;
  codexFindings: unknown | null;
  sentryFindings: unknown | null;
  messages: Array<{ direction: string; body: string }>;
  maxIterations: number;
  github: {
    token: string | null;
    owner: string | null;
    repo: string | null;
    baseBranch: string;
  };
  models: {
    fix: string;
    review: string;
  };
  requiredCheckNames: string[];
  codexRepositoryIds: string[];
}

export interface ResolveFixTargetRepositoryParams {
  repositoryIds: string[];
  filePaths: string[];
  preferredOwner?: string | null;
  preferredRepo?: string | null;
  configuredBaseBranch: string;
}

export interface FixTargetRepository {
  repositoryId: string;
  localPath: string;
  owner: string | null;
  repo: string | null;
  baseBranch: string;
  canCreatePullRequest: boolean;
}

export interface CreateFixPullRequestInput {
  runId: string;
  summary: string;
  patchPlan: string;
  changedFiles: string[];
  targetRepository: FixTargetRepository;
  workingDirectory: string;
  githubToken: string;
  iteration: number;
}

export interface CreateFixPullRequestResult {
  branchName: string;
  prUrl: string;
  prNumber: number;
  headSha: string;
}

function hasCodeContext(codexFindings: unknown | null): boolean {
  return expandFixPrCodeContext(codexFindings).editScope.length > 0;
}

export async function getFixRunContext(
  input: GenerateFixPRWorkflowInput,
): Promise<FixRunContext | null> {
  const run = await prisma.fixPrRun.findUnique({
    where: { id: input.runId },
    include: {
      analysis: {
        include: {
          thread: {
            include: {
              messages: {
                orderBy: { createdAt: "asc" },
                take: 20,
              },
            },
          },
        },
      },
      workspace: {
        include: {
          agentConfig: true,
        },
      },
    },
  });

  if (!run || run.status === "CANCELLED") {
    debugLog("run not available", { runId: input.runId, status: run?.status ?? "not_found" });
    return null;
  }

  let analysisSummary = run.analysis.summary;
  let analysisRcaSummary = run.analysis.rcaSummary;
  let analysisCodexFindings = run.analysis.codexFindings;
  let analysisSentryFindings = run.analysis.sentryFindings;
  let resolvedAnalysisId = run.analysisId;

  if (!hasCodeContext(analysisCodexFindings)) {
    const recentAnalyses = await prisma.threadAnalysis.findMany({
      where: {
        threadId: run.threadId,
        workspaceId: run.workspaceId,
        id: { not: run.analysisId },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        summary: true,
        rcaSummary: true,
        codexFindings: true,
        sentryFindings: true,
        sufficient: true,
      },
    });

    const preferredAnalysis =
      recentAnalyses.find((analysis) => analysis.sufficient && hasCodeContext(analysis.codexFindings))
      ?? recentAnalyses.find((analysis) => hasCodeContext(analysis.codexFindings));

    if (preferredAnalysis) {
      resolvedAnalysisId = preferredAnalysis.id;
      analysisSummary = preferredAnalysis.summary;
      analysisRcaSummary = preferredAnalysis.rcaSummary;
      analysisCodexFindings = preferredAnalysis.codexFindings;
      analysisSentryFindings = preferredAnalysis.sentryFindings;
      console.log(
        `[fix-pr] run ${run.id} using fallback analysis ${preferredAnalysis.id} because ${run.analysisId} had empty codex findings`,
      );
    } else {
      console.log(`[fix-pr] run ${run.id} no alternate analysis with code context for ${run.analysisId}`);
    }
  }

  const initialContext = expandFixPrCodeContext(run.analysis.codexFindings);
  const resolvedContext = expandFixPrCodeContext(analysisCodexFindings);
  debugLog("run context analysis snapshot", {
    runId: run.id,
    threadId: run.threadId,
    analysisId: run.analysisId,
    selectedAnalysisId: resolvedAnalysisId,
    fallbackUsed: resolvedAnalysisId !== run.analysisId,
    initialEditScopeCount: initialContext.editScope.length,
    resolvedEditScopeCount: resolvedContext.editScope.length,
    messageCount: run.analysis.thread.messages.length,
  });

  const config = run.workspace.agentConfig;
  const configuredRepoIds = config?.codexRepositoryIds ?? [];
  let codexRepositoryIds = configuredRepoIds;
  const repoSource = configuredRepoIds.length > 0 ? "workspaceConfig" : "workspaceRepos";

  // Fallback: if workspace config does not explicitly scope repos, use all indexed repos.
  if (codexRepositoryIds.length === 0) {
    const workspaceRepos = await prisma.codexRepository.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true },
    });
    codexRepositoryIds = workspaceRepos.map((repo) => repo.id);
  }

  debugLog("run context repositories", {
    runId: run.id,
    repoSource,
    configuredRepoCount: configuredRepoIds.length,
    resolvedRepoCount: codexRepositoryIds.length,
    workspaceId: input.workspaceId,
    hasWorkspaceConfig: Boolean(config?.codexRepositoryIds?.length),
    hasGithubConfig: Boolean(config?.githubToken && config?.githubDefaultOwner && config?.githubDefaultRepo),
  });

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    threadId: run.threadId,
    analysisId: resolvedAnalysisId,
    summary: analysisSummary,
    rcaSummary: analysisRcaSummary,
    codexFindings: analysisCodexFindings,
    sentryFindings: analysisSentryFindings,
    messages: run.analysis.thread.messages.map((message) => ({
      direction: message.direction,
      body: message.body,
    })),
    maxIterations: run.maxIterations,
    github: {
      token: config?.githubToken ?? codexConfig.githubToken ?? null,
      owner: config?.githubDefaultOwner ?? null,
      repo: config?.githubDefaultRepo ?? null,
      baseBranch: config?.githubBaseBranch ?? "main",
    },
    models: {
      fix: config?.codexFixModel ?? codexConfig.llm.model,
      review: config?.codexReviewModel ?? codexConfig.llm.model,
    },
    requiredCheckNames: config?.codexRequiredCheckNames ?? [],
    codexRepositoryIds,
  };
}

export async function startParentCodexThread(params: {
  runId: string;
  analysisId: string;
}): Promise<string> {
  // The first pass keeps Temporal as the source of orchestration truth and
  // uses a synthetic thread id until Codex app-server thread/fork APIs are wired in.
  return `fix-pr-parent-${params.analysisId}-${params.runId}`;
}

export async function runRcaAgent(params: {
  summary: string;
  rcaSummary: string | null;
  codexFindings: unknown | null;
  sentryFindings: unknown | null;
}): Promise<FixPrRcaOutput> {
  return generateFixPrRca(
    {
      analysisSummary: params.summary,
      analysisRcaSummary: params.rcaSummary,
      codexFindings: params.codexFindings,
      sentryFindings: params.sentryFindings,
    },
    {
      apiKey: codexConfig.llm.apiKey,
      model: codexConfig.llm.model,
    },
  );
}

export async function runCodeContextAgent(params: {
  workspaceId?: string;
  summary?: string;
  rcaSummary?: string | null;
  repositoryIds?: string[];
  messages?: Array<{ direction: string; body: string }>;
  codexFindings: unknown | null;
}): Promise<FixPrCodeContextOutput> {
  const cachedContext = expandFixPrCodeContext(params.codexFindings);
  if (cachedContext.editScope.length > 0) {
    debugLog("runCodeContextAgent used cached context", {
      workspaceId: params.workspaceId,
      editScopeCount: cachedContext.editScope.length,
      symbolCount: cachedContext.symbols.length,
      relatedChunkCount: cachedContext.relatedChunks.length,
    });
    return cachedContext;
  }

  if (!params.workspaceId) {
    debugLog("runCodeContextAgent skipped", { reason: "missing_workspace", cachedEditScopeCount: cachedContext.editScope.length });
    return cachedContext;
  }

  let repositoryIds = params.repositoryIds ?? [];
  if (repositoryIds.length === 0) {
    const workspaceRepos = await prisma.codexRepository.findMany({
      where: { workspaceId: params.workspaceId },
      select: { id: true },
    });
    repositoryIds = workspaceRepos.map((repo) => repo.id);
  }
  if (repositoryIds.length === 0) {
    console.warn(`[fix-pr] no Codex repositories available for workspace ${params.workspaceId}`);
    return cachedContext;
  }

  const recentMessageBodies = (params.messages ?? [])
    .filter((message) => message.direction === "INBOUND" || message.direction === "SYSTEM")
    .slice(-3)
    .map((message) => message.body.trim())
    .filter(Boolean);

  const searchQuery = [params.summary, params.rcaSummary, ...recentMessageBodies]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  if (!searchQuery) {
    debugLog("runCodeContextAgent skipped", { reason: "empty_query", repositoryIdsCount: repositoryIds.length });
    return cachedContext;
  }
  debugLog("runCodeContextAgent query", {
    workspaceId: params.workspaceId,
    searchQueryLength: searchQuery.length,
    repositoryIds: repositoryIds.length,
    messageCount: params.messages?.length ?? 0,
  });

  try {
    const response = await fetch(`${codexConfig.webAppUrl}/api/rest/codex/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        query: searchQuery,
        repositoryIds,
        limit: 10,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      console.warn(`[fix-pr] fresh codex search failed (${response.status})`);
      debugLog("runCodeContextAgent search failed", {
        workspaceId: params.workspaceId,
        status: response.status,
      });
      return cachedContext;
    }

    const freshFindings = (await response.json()) as unknown;
    const freshContext = expandFixPrCodeContext(freshFindings);
    if (freshContext.editScope.length > 0) {
      console.log(`[fix-pr] fresh code context recovered ${freshContext.editScope.length} files`);
      debugLog("runCodeContextAgent recovered fresh context", {
        runSummaryLength: params.summary?.length ?? 0,
        freshEditScopeCount: freshContext.editScope.length,
        freshSymbolCount: freshContext.symbols.length,
      });
      return freshContext;
    }
  } catch (error) {
    console.warn("[fix-pr] fresh codex search errored:", error);
    debugLog("runCodeContextAgent search errored", {
      workspaceId: params.workspaceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return cachedContext;
}

export async function runTestAgent(params: {
  codeContext: FixPrCodeContextOutput;
  requiredCheckNames: string[];
}): Promise<FixPrTestPlan> {
  return buildFixPrTestPlan({
    filePaths: params.codeContext.editScope,
    requiredChecks: params.requiredCheckNames,
  });
}

export async function runFixerAgent(params: {
  rca: FixPrRcaOutput;
  codeContext: FixPrCodeContextOutput;
  testPlan: FixPrTestPlan;
  priorFailures: string[];
  model: string;
  workingDirectory?: string;
  targetRepositoryId?: string;
  codexFindings?: unknown | null;
}): Promise<FixPrFixerOutput> {
  const workingDirectory = resolveActivityWorkingDirectory("runFixerAgent", params.workingDirectory, {
    expectedRepositoryId: params.targetRepositoryId,
    fileHints: params.codeContext.editScope,
  });
  debugLog("runFixerAgent context", {
    runSummaryLength: params.rca.summary.length,
    editScopeCount: params.codeContext.editScope.length,
    codexContextChunkCount: expandFixPrCodeContext(params.codexFindings ?? null).relatedChunks.length,
    workingDirectory,
    requiredChanges: params.testPlan.requiredChecks.join(","),
  });
  let fileContents = await loadFileContents(params.codeContext.editScope, workingDirectory);
  console.log(`[fix-pr] Local files found: ${fileContents.length}/${params.codeContext.editScope.length}`);
  debugLog("runFixerAgent file contents", {
    requestedFiles: params.codeContext.editScope,
    loadedFileCount: fileContents.length,
  });

  // Fallback: if local files not found, use chunk content from Codex search results
  if (fileContents.length === 0 && params.codexFindings) {
    const findings = params.codexFindings as {
      chunks?: Array<{ filePath?: string; content?: string; symbolName?: string }>;
    };
    const chunkCount = findings.chunks?.length ?? 0;
    console.log(`[fix-pr] Falling back to Codex chunks: ${chunkCount} chunks available`);
    if (findings.chunks && findings.chunks.length > 0) {
      const byFile = new Map<string, string[]>();
      for (const chunk of findings.chunks) {
        if (chunk.filePath && chunk.content) {
          const existing = byFile.get(chunk.filePath) ?? [];
          existing.push(chunk.content);
          byFile.set(chunk.filePath, existing);
        }
      }
      fileContents = [...byFile.entries()].map(([filePath, contents]) => ({
        filePath,
        content: contents.join("\n\n// ...\n\n"),
      }));
      console.log(`[fix-pr] Loaded ${fileContents.length} files from Codex chunks`);
    }
  }

  // Last resort: if still no file contents, tell the LLM to generate a new file
  if (fileContents.length === 0) {
    console.log("[fix-pr] No file contents at all — adding placeholder for LLM to create");
    debugLog("runFixerAgent fallback", { reason: "no_contents" });
    const targetFile = params.codeContext.editScope[0] ?? "src/fix.ts";
    fileContents = [{
      filePath: targetFile,
      content: "// File not found — generate the fix as a new file or patch",
    }];
  }

  return generateCodexFix(
    {
      rca: params.rca,
      codeContext: params.codeContext,
      testPlan: params.testPlan,
      fileContents,
      priorFailures: params.priorFailures,
    },
    {
      apiKey: codexConfig.llm.apiKey,
      model: params.model,
    },
  );
}

export async function applyWorkspacePatch(params: {
  fixerOutput: FixPrFixerOutput;
  workingDirectory?: string;
  targetRepositoryId?: string;
}): Promise<{ appliedFiles: string[]; headSha: string }> {
  const appliedFiles: string[] = [];
  const workingDirectory = resolveActivityWorkingDirectory("applyWorkspacePatch", params.workingDirectory, {
    expectedRepositoryId: params.targetRepositoryId,
    fileHints: params.fixerOutput.changedFiles.map((change) => change.filePath),
  });

  debugLog("applyWorkspacePatch", {
    changedFileCount: params.fixerOutput.changedFiles.length,
    workingDirectory,
  });

  for (const change of params.fixerOutput.changedFiles) {
    appliedFiles.push(await applyFileChange(change, workingDirectory));
  }

  return {
    appliedFiles,
    headSha: buildChangedFilesDigest(params.fixerOutput.changedFiles),
  };
}

export async function runReviewerAgent(params: {
  rca: FixPrRcaOutput;
  fixerOutput: FixPrFixerOutput;
  testPlan: FixPrTestPlan;
  model: string;
}): Promise<FixPrReviewerOutput> {
  return reviewCodexFix(
    {
      rcaSummary: params.rca.summary,
      changedFiles: params.fixerOutput.changedFiles.map((fileChange) => ({
        filePath: fileChange.filePath,
        diff: buildInlineDiff(fileChange.original, fileChange.updated),
      })),
      testPlan: params.testPlan.commands,
    },
    {
      apiKey: codexConfig.llm.apiKey,
      model: params.model,
    },
  );
}

export async function runChecksAgent(params: {
  commands: string[];
  workingDirectory?: string;
}): Promise<FixPrChecksOutput> {
  debugLog("runChecksAgent", {
    commandCount: params.commands.length,
    workingDirectory: params.workingDirectory,
  });
  const commandsRun: FixPrChecksOutput["commandsRun"] = [];
  const failures: string[] = [];
  const logs: string[] = [];
  const workingDirectory = resolveActivityWorkingDirectory("runChecksAgent", params.workingDirectory, {
    allowNoGit: true,
  });

  for (const command of params.commands) {
    const result = await runCheckCommand(command, workingDirectory);
    commandsRun.push(result);
    appendTrimmedLog(logs, result.stdout);
    appendTrimmedLog(logs, result.stderr);

    if (result.exitCode !== 0) {
      failures.push(command);
    }
  }

  return {
    passed: failures.length === 0,
    commandsRun,
    failures,
    logs,
  };
}

export async function saveFixRunProgress(
  input: SaveFixPRProgressInput,
): Promise<void> {
  debugLog("saveFixRunProgress request", {
    runId: input.runId,
    status: input.status,
    currentStage: input.currentStage,
    iteration: input.iteration?.iteration,
  });
  const response = await fetch(`${codexConfig.webAppUrl}/api/rest/fix-pr/progress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": codexConfig.internalApiSecret,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to save fix run progress (${response.status}): ${body}`);
  }
}

export async function resolveFixTargetRepository(
  params: ResolveFixTargetRepositoryParams,
): Promise<FixTargetRepository | null> {
  const repositoryIds = [...new Set(params.repositoryIds)];
  if (repositoryIds.length === 0) {
    debugLog("resolveFixTargetRepository skipped", { reason: "no_repository_ids", filePathCount: params.filePaths.length });
    return null;
  }

  debugLog("resolveFixTargetRepository start", {
    repositoryIds: repositoryIds.length,
    filePathCount: params.filePaths.length,
    preferredOwner: params.preferredOwner,
    preferredRepo: params.preferredRepo,
    configuredBaseBranch: params.configuredBaseBranch,
  });

  const repositories = await prisma.codexRepository.findMany({
    where: { id: { in: repositoryIds } },
    select: {
      id: true,
      sourceType: true,
      sourceUrl: true,
      defaultBranch: true,
      displayName: true,
    },
  });

  if (repositories.length === 0) {
    debugLog("resolveFixTargetRepository none", { repositoryIds });
    return null;
  }

  let selectedRepository: (typeof repositories)[number] = repositories[0]!;
  debugLog("resolveFixTargetRepository selected by default", {
    repositoryId: selectedRepository.id,
    defaultBranch: selectedRepository.defaultBranch,
  });

  if (params.filePaths.length > 0) {
    const fileMatches = await prisma.codexFile.findMany({
      where: {
        repositoryId: { in: repositoryIds },
        filePath: { in: params.filePaths },
      },
      select: {
        repositoryId: true,
      },
    });

    const matchCounts = new Map<string, number>();
    for (const match of fileMatches) {
      const nextCount = (matchCounts.get(match.repositoryId) ?? 0) + 1;
      matchCounts.set(match.repositoryId, nextCount);
    }

    let bestMatchCount = 0;
    for (const [repoId, count] of matchCounts.entries()) {
      if (count > bestMatchCount) {
        const repo = repositories.find((candidate) => candidate.id === repoId);
        if (repo) {
          selectedRepository = repo;
          bestMatchCount = count;
        }
      }
    }
  }

  debugLog("resolveFixTargetRepository resolved", {
    repositoryId: selectedRepository.id,
    localPath: path.resolve(codexConfig.cloneBasePath, selectedRepository.id),
  });

  const parsedRemote = parseGitHubOwnerRepo(selectedRepository.sourceUrl);
  const owner = params.preferredOwner ?? parsedRemote?.owner ?? null;
  const repo = params.preferredRepo ?? parsedRemote?.repo ?? null;
  const localPath = path.resolve(codexConfig.cloneBasePath, selectedRepository.id);

  return {
    repositoryId: selectedRepository.id,
    localPath,
    owner,
    repo,
    baseBranch: selectedRepository.defaultBranch ?? params.configuredBaseBranch ?? "main",
    canCreatePullRequest:
      existsSync(localPath)
      && existsSync(path.join(localPath, ".git"))
      && selectedRepository.sourceType === "GITHUB"
      && Boolean(owner && repo),
  };
}

export async function createFixPullRequest(
  params: CreateFixPullRequestInput,
): Promise<CreateFixPullRequestResult> {
  debugLog("createFixPullRequest start", {
    runId: params.runId,
    owner: params.targetRepository.owner,
    repo: params.targetRepository.repo,
    baseBranch: params.targetRepository.baseBranch,
    changedFileCount: params.changedFiles.length,
    iteration: params.iteration,
  });
  const workingDirectory = resolveActivityWorkingDirectory("createFixPullRequest", params.workingDirectory, {
    expectedRepositoryId: params.targetRepository.repositoryId,
  });

  if (!existsSync(workingDirectory)) {
    throw new Error(`Working directory not found: ${params.workingDirectory}`);
  }

  if (!params.targetRepository.owner || !params.targetRepository.repo) {
    throw new Error("Unable to determine GitHub owner/repo for pull request creation");
  }

  const branchName = buildBranchName(params.runId, params.iteration);
  const commitMessage = buildCommitMessage(params.summary);
  const body = buildPullRequestBody({
    runId: params.runId,
    summary: params.summary,
    patchPlan: params.patchPlan,
  });

  debugLog("createFixPullRequest commit", {
    branchName,
    commitMessage,
    bodyLength: body.length,
  });

  await runGitCommand(
    workingDirectory,
    ["checkout", "-B", branchName, params.targetRepository.baseBranch],
  );
  if (params.changedFiles.length === 0) {
    await runGitCommand(workingDirectory, ["add", "-A"]);
  } else {
    await runGitCommand(workingDirectory, ["add", "--", ...params.changedFiles]);
  }
  try {
    await runGitCommand(workingDirectory, ["commit", "-m", commitMessage]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No changes to commit: ${message}`);
  }

  const headSha = await runGitCommand(workingDirectory, ["rev-parse", "HEAD"]).then((result) =>
    result.stdout.trim(),
  );

  await runGitCommand(workingDirectory, ["push", "--set-upstream", "origin", branchName]);
  const githubClient = createGitHubClient(params.githubToken);
  const pr = await createDraftPullRequest(githubClient, {
    owner: params.targetRepository.owner,
    repo: params.targetRepository.repo,
    title: `[Codex Fix] ${params.summary}`,
    body,
    head: branchName,
    base: params.targetRepository.baseBranch,
  });

  return {
    branchName,
    prUrl: pr.prUrl,
    prNumber: pr.prNumber,
    headSha,
  };
}

async function loadFileContents(
  filePaths: string[],
  workingDirectory?: string,
): Promise<Array<{ filePath: string; content: string }>> {
  const baseDirectory = workingDirectory ?? repoRootDir;
  const results: Array<{ filePath: string; content: string }> = [];

  for (const filePath of filePaths) {
    const absolutePath = resolveWorkspaceFilePath(filePath, baseDirectory);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      results.push({ filePath, content });
    } catch {
      continue;
    }
  }

  return results;
}

function buildInlineDiff(original: string, updated: string): string {
  return [
    "--- original",
    original,
    "+++ updated",
    updated,
  ].join("\n");
}

async function applyFileChange(
  change: FixPrFixerOutput["changedFiles"][number],
  workingDirectory: string,
): Promise<string> {
  const absolutePath = resolveWorkspaceFilePath(change.filePath, workingDirectory);
  const currentContent = await fs.readFile(absolutePath, "utf8");
  const nextContent = replaceSingleExactMatch(currentContent, change);
  await fs.writeFile(absolutePath, nextContent, "utf8");
  return change.filePath;
}

function buildChangedFilesDigest(changedFiles: FixPrFixerOutput["changedFiles"]): string {
  return createHash("sha1")
    .update(JSON.stringify(changedFiles))
    .digest("hex");
}

function resolveActivityWorkingDirectory(
  operation: string,
  workingDirectory?: string,
  opts: {
    expectedRepositoryId?: string | null;
    fileHints?: string[];
    allowNoGit?: boolean;
  } = {},
): string {
  const explicitDirectory = workingDirectory
    ? path.resolve(workingDirectory)
    : repoRootDir;
  const resolved = tryResolveWorkingDirectory(operation, explicitDirectory, opts);
  if (resolved) {
    return resolved;
  }

  if (!workingDirectory) {
    throw new Error(`${operation} could not resolve a valid working directory from default context.`);
  }

  throw new Error(`${operation} could not resolve a valid working directory from: ${workingDirectory}`);
}

function resolveGitRepoRoot(candidate: string): string | null {
  const candidateGitRoot = path.resolve(candidate);
  if (existsSync(candidateGitRoot) && isDirectoryWithGit(candidateGitRoot)) {
    return candidateGitRoot;
  }

  return null;
}

function tryResolveWorkingDirectory(
  operation: string,
  workingDirectory: string,
  opts: {
    expectedRepositoryId?: string | null;
    fileHints?: string[];
    allowNoGit?: boolean;
  },
): string | null {
  if (!existsSync(workingDirectory) || !lstatSync(workingDirectory).isDirectory()) {
    return null;
  }

  if (opts.fileHints?.length) {
    const canUseWorkingDirectory = opts.fileHints.every((fileHint) =>
      canResolveFilePathInDirectory(workingDirectory, fileHint),
    );
    if (canUseWorkingDirectory) {
      return workingDirectory;
    }
  }

  const fallbackCandidate = resolveGitRepoRoot(workingDirectory);
  if (fallbackCandidate) {
    return fallbackCandidate;
  }

  if (opts.allowNoGit) {
    return workingDirectory;
  }

  if (opts.expectedRepositoryId) {
    const byRepositoryId = resolveGitRepoRoot(path.resolve(codexCloneBasePath, opts.expectedRepositoryId));
    if (byRepositoryId) {
      debugLog("resolveActivityWorkingDirectory fallbackByRepositoryId", {
        operation,
        expectedRepositoryId: opts.expectedRepositoryId,
        workingDirectory,
        resolved: byRepositoryId,
      });
      return byRepositoryId;
    }
  }

  const cloneCandidate = resolveByFileHints(opts.fileHints ?? []);
  if (cloneCandidate) {
    debugLog("resolveActivityWorkingDirectory fallbackByFileHints", {
      operation,
      workingDirectory,
      resolved: cloneCandidate,
    });
    return cloneCandidate;
  }
  return null;
}

function isDirectoryWithGit(candidatePath: string): boolean {
  if (!existsSync(candidatePath)) {
    return false;
  }

  try {
    return lstatSync(candidatePath).isDirectory() && existsSync(path.join(candidatePath, ".git"));
  } catch {
    return false;
  }
}

function resolveByFileHints(fileHints: string[]): string | null {
  const entries = safeReadCloneDirectories();
  const candidates: string[] = [];

  for (const entry of entries) {
    const base = path.resolve(codexCloneBasePath, entry);
    if (!isDirectoryWithGit(base)) {
      continue;
    }

    const hasAllFiles = fileHints.every((fileHint) => existsSync(path.resolve(base, fileHint)));
    if (hasAllFiles) {
      candidates.push(base);
    }
  }

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  return null;
}

function canResolveFilePathInDirectory(
  workingDirectory: string,
  filePath: string,
): boolean {
  try {
    const trimmedPath = filePath.trim();
    if (!trimmedPath || path.isAbsolute(trimmedPath)) return false;
    const absolutePath = path.resolve(workingDirectory, trimmedPath);
    const relativePath = path.relative(workingDirectory, absolutePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return false;
    return existsSync(absolutePath);
  } catch {
    return false;
  }
}

function safeReadCloneDirectories(): string[] {
  try {
    return readdirSync(codexCloneBasePath, { withFileTypes: true })
      .filter((entry: Dirent) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function runCheckCommand(
  command: string,
  workingDirectory?: string,
): Promise<FixPrChecksOutput["commandsRun"][number]> {
  const cwd = workingDirectory ?? repoRootDir;
  const resolvedWorkingDirectory = resolveActivityWorkingDirectory("runCheckCommand", cwd, {
    allowNoGit: true,
  });
  try {
    const { stdout, stderr } = await exec(command, {
      cwd: resolvedWorkingDirectory,
      timeout: 10 * 60 * 1000,
    });

    return {
      command,
      exitCode: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message: string;
    };

    return {
      command,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message,
    };
  }
}

async function runGitCommand(
  workingDirectory: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  debugLog("runGitCommand", { workingDirectory, args });
  const result = await execFile("git", args, {
    cwd: workingDirectory,
    timeout: 10 * 60 * 1000,
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function buildBranchName(runId: string, iteration: number): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40);
  return `codex-fix/${safeRunId}-${iteration}-${Date.now()}`;
}

function buildCommitMessage(summary: string): string {
  const sanitizedSummary = summary.trim().replace(/\s+/g, " ").slice(0, 80) || "Automated fix";
  return `chore(codex): ${sanitizedSummary}`;
}

function buildPullRequestBody(params: { runId: string; summary: string; patchPlan: string }): string {
  const bulletRows = params.patchPlan
    .split("\n")
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => `- ${line}`)
    .join("\n");

  return [
    `Automated fix generated by Codex for run **${params.runId}**.`,
    "",
    `Summary: ${params.summary}`,
    "",
    "Patch plan:",
    bulletRows || "- (plan not provided)",
  ].join("\n");
}

function parseGitHubOwnerRepo(sourceUrl: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(sourceUrl);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parsed.hostname === "github.com") {
      const owner = parts[0];
      const rawRepo = parts[1];
      if (!owner || !rawRepo) {
        return null;
      }
      return {
        owner,
        repo: rawRepo.replace(/\.git$/, ""),
      };
    }
  } catch {
    // Fall through to SSH-style fallback parsing.
  }

  const sshMatch = sourceUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!sshMatch) {
    return null;
  }
  const owner = sshMatch[1];
  const repo = sshMatch[2];
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
  };
}

function appendTrimmedLog(logs: string[], value: string): void {
  const trimmedValue = value.trim();
  if (trimmedValue) {
    logs.push(trimmedValue);
  }
}

function replaceSingleExactMatch(
  currentContent: string,
  change: FixPrFixerOutput["changedFiles"][number],
): string {
  if (change.original.length === 0) {
    throw new Error(`Original snippet must not be empty for ${change.filePath}`);
  }

  const matchCount = currentContent.split(change.original).length - 1;
  if (matchCount === 0) {
    throw new Error(`Original snippet not found in ${change.filePath}`);
  }

  if (matchCount > 1) {
    throw new Error(`Original snippet matched multiple locations in ${change.filePath}`);
  }

  return currentContent.replace(change.original, change.updated);
}

function resolveWorkspaceFilePath(filePath: string, baseDirectory?: string): string {
  const workingDirectory = resolveActivityWorkingDirectory("loadFile", baseDirectory, {
    allowNoGit: true,
  });
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    throw new Error("File path must not be empty");
  }

  if (path.isAbsolute(trimmedPath)) {
    throw new Error(`Absolute file paths are not allowed: ${filePath}`);
  }

  const absolutePath = path.resolve(workingDirectory, trimmedPath);
  const relativePath = path.relative(workingDirectory, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`File path escapes repo root: ${filePath}`);
  }

  return absolutePath;
}
