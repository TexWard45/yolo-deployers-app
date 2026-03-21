import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prisma } from "@shared/database";
import {
  buildFixPrTestPlan,
  expandFixPrCodeContext,
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

  const config = run.workspace.agentConfig;

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    threadId: run.threadId,
    analysisId: run.analysisId,
    summary: run.analysis.summary,
    rcaSummary: run.analysis.rcaSummary,
    codexFindings: run.analysis.codexFindings,
    sentryFindings: run.analysis.sentryFindings,
    messages: run.analysis.thread.messages.map((message) => ({
      direction: message.direction,
      body: message.body,
    })),
    maxIterations: run.maxIterations,
    github: {
      token: config?.githubToken ?? null,
      owner: config?.githubDefaultOwner ?? null,
      repo: config?.githubDefaultRepo ?? null,
      baseBranch: config?.githubBaseBranch ?? "main",
    },
    models: {
      fix: config?.codexFixModel ?? codexConfig.llm.model,
      review: config?.codexReviewModel ?? codexConfig.llm.model,
    },
    requiredCheckNames: config?.codexRequiredCheckNames ?? [],
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
  codexFindings: unknown | null;
}): Promise<FixPrCodeContextOutput> {
  return expandFixPrCodeContext(params.codexFindings);
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
  codexFindings?: unknown | null;
}): Promise<FixPrFixerOutput> {
  let fileContents = await loadFileContents(params.codeContext.editScope);
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
}): Promise<{ appliedFiles: string[]; headSha: string }> {
  const appliedFiles: string[] = [];

  for (const change of params.fixerOutput.changedFiles) {
    appliedFiles.push(await applyFileChange(change));
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
}): Promise<FixPrChecksOutput> {
  const commandsRun: FixPrChecksOutput["commandsRun"] = [];
  const failures: string[] = [];
  const logs: string[] = [];

  for (const command of params.commands) {
    const result = await runCheckCommand(command);
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

async function loadFileContents(filePaths: string[]): Promise<Array<{ filePath: string; content: string }>> {
  const results: Array<{ filePath: string; content: string }> = [];

  for (const filePath of filePaths) {
    const absolutePath = resolveWorkspaceFilePath(filePath);
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

async function applyFileChange(change: FixPrFixerOutput["changedFiles"][number]): Promise<string> {
  const absolutePath = resolveWorkspaceFilePath(change.filePath);
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
): Promise<FixPrChecksOutput["commandsRun"][number]> {
  try {
    const { stdout, stderr } = await exec(command, {
      cwd: repoRootDir,
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

function resolveWorkspaceFilePath(filePath: string): string {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    throw new Error("File path must not be empty");
  }

  if (path.isAbsolute(trimmedPath)) {
    throw new Error(`Absolute file paths are not allowed: ${filePath}`);
  }

  const absolutePath = path.resolve(repoRootDir, trimmedPath);
  const relativePath = path.relative(repoRootDir, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`File path escapes repo root: ${filePath}`);
  }

  return absolutePath;
}
