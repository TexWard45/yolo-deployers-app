import { promisify } from "node:util";
import { exec as execCallback, execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
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

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);
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
    return null;
  }

  let analysisSummary = run.analysis.summary;
  let analysisRcaSummary = run.analysis.rcaSummary;
  let analysisCodexFindings = run.analysis.codexFindings;
  let analysisSentryFindings = run.analysis.sentryFindings;

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
      analysisSummary = preferredAnalysis.summary;
      analysisRcaSummary = preferredAnalysis.rcaSummary;
      analysisCodexFindings = preferredAnalysis.codexFindings;
      analysisSentryFindings = preferredAnalysis.sentryFindings;
      console.log(
        `[fix-pr] run ${run.id} using fallback analysis ${preferredAnalysis.id} because ${run.analysisId} had empty codex findings`,
      );
    }
  }

  const config = run.workspace.agentConfig;
  const configuredRepoIds = config?.codexRepositoryIds ?? [];
  let codexRepositoryIds = configuredRepoIds;

  // Fallback: if workspace config does not explicitly scope repos, use all indexed repos.
  if (codexRepositoryIds.length === 0) {
    const workspaceRepos = await prisma.codexRepository.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true },
    });
    codexRepositoryIds = workspaceRepos.map((repo) => repo.id);
  }

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    threadId: run.threadId,
    analysisId: run.analysisId,
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
    return cachedContext;
  }

  if (!params.workspaceId) {
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
    return cachedContext;
  }

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
      return cachedContext;
    }

    const freshFindings = (await response.json()) as unknown;
    const freshContext = expandFixPrCodeContext(freshFindings);
    if (freshContext.editScope.length > 0) {
      console.log(`[fix-pr] fresh code context recovered ${freshContext.editScope.length} files`);
      return freshContext;
    }
  } catch (error) {
    console.warn("[fix-pr] fresh codex search errored:", error);
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
  codexFindings?: unknown | null;
}): Promise<FixPrFixerOutput> {
  const workingDirectory = params.workingDirectory ?? repoRootDir;
  let fileContents = await loadFileContents(params.codeContext.editScope, workingDirectory);
  console.log(`[fix-pr] Local files found: ${fileContents.length}/${params.codeContext.editScope.length}`);

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
}): Promise<{ appliedFiles: string[]; headSha: string }> {
  const appliedFiles: string[] = [];
  const workingDirectory = params.workingDirectory ?? repoRootDir;

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
  const commandsRun: FixPrChecksOutput["commandsRun"] = [];
  const failures: string[] = [];
  const logs: string[] = [];
  const workingDirectory = params.workingDirectory ?? repoRootDir;

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
    return null;
  }

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
    return null;
  }

  let selectedRepository: (typeof repositories)[number] | undefined = repositories[0];
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

  if (!selectedRepository) {
    return null;
  }

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
  if (!existsSync(params.workingDirectory)) {
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

  await runGitCommand(
    params.workingDirectory,
    ["checkout", "-B", branchName, params.targetRepository.baseBranch],
  );
  if (params.changedFiles.length === 0) {
    await runGitCommand(params.workingDirectory, ["add", "-A"]);
  } else {
    await runGitCommand(params.workingDirectory, ["add", "--", ...params.changedFiles]);
  }
  try {
    await runGitCommand(params.workingDirectory, ["commit", "-m", commitMessage]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No changes to commit: ${message}`);
  }

  const headSha = await runGitCommand(params.workingDirectory, ["rev-parse", "HEAD"]).then((result) =>
    result.stdout.trim(),
  );

  await runGitCommand(params.workingDirectory, ["push", "--set-upstream", "origin", branchName]);
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

async function runCheckCommand(
  command: string,
  workingDirectory?: string,
): Promise<FixPrChecksOutput["commandsRun"][number]> {
  const cwd = workingDirectory ?? repoRootDir;
  try {
    const { stdout, stderr } = await exec(command, {
      cwd,
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
  const workingDirectory = baseDirectory ?? repoRootDir;
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
