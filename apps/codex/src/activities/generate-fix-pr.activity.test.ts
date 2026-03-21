import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

function setCodexTestEnv(): void {
  process.env.NODE_ENV ??= "test";
  process.env.TEMPORAL_ADDRESS ??= "localhost:7233";
  process.env.TEMPORAL_NAMESPACE ??= "default";
  process.env.CODEX_TASK_QUEUE ??= "codex-sync-queue";
  process.env.WEB_APP_URL ??= "http://localhost:3000";
  process.env.INTERNAL_API_SECRET ??= "test-secret";
  process.env.CODEX_EMBEDDING_API_KEY ??= "test-embedding-key";
  process.env.CODEX_CLONE_BASE_PATH ??= "/tmp/codex-clones";
}

test("runChecksAgent executes repo-scoped commands from the workspace root", async () => {
  setCodexTestEnv();

  const { runChecksAgent, repoRootDir } = await import("./generate-fix-pr.activity.js");
  const result = await runChecksAgent({
    commands: ['node -e "process.stdout.write(process.cwd())"'],
  });

  assert.equal(result.passed, true);
  assert.equal(result.commandsRun[0]?.stdout, repoRootDir);
});

test("applyWorkspacePatch resolves repo-relative file paths", async () => {
  setCodexTestEnv();

  const { applyWorkspacePatch, repoRootDir } = await import("./generate-fix-pr.activity.js");
  const tempDir = await mkdtemp(path.join(repoRootDir, ".tmp-fix-pr-"));
  const relativePath = path.relative(repoRootDir, path.join(tempDir, "example.ts"));

  try {
    await writeFile(path.join(tempDir, "example.ts"), "const value = 'before';\n", "utf8");

    const result = await applyWorkspacePatch({
      fixerOutput: {
        summary: "update value",
        patchPlan: "replace literal",
        riskNotes: [],
        cannotFixSafely: false,
          confidence: 0.8,
        changedFiles: [
          {
            filePath: relativePath,
            original: "'before'",
            updated: "'after'",
            explanation: "update the literal",
          },
        ],
      },
    });

    const content = await readFile(path.join(tempDir, "example.ts"), "utf8");
    assert.equal(content, "const value = 'after';\n");
    assert.deepEqual(result.appliedFiles, [relativePath]);
    assert.ok(result.headSha.length > 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyWorkspacePatch rejects file paths that escape the repo root", async () => {
  setCodexTestEnv();

  const { applyWorkspacePatch } = await import("./generate-fix-pr.activity.js");

  await assert.rejects(
    () =>
      applyWorkspacePatch({
        fixerOutput: {
          summary: "malicious patch",
          patchPlan: "escape repo root",
          riskNotes: [],
          cannotFixSafely: false,
          confidence: 0.8,
          changedFiles: [
            {
              filePath: "../outside.ts",
              original: "before",
              updated: "after",
              explanation: "should not be allowed",
            },
          ],
        },
      }),
    /escapes repo root/,
  );
});

test("applyWorkspacePatch rejects ambiguous snippet replacements", async () => {
  setCodexTestEnv();

  const { applyWorkspacePatch, repoRootDir } = await import("./generate-fix-pr.activity.js");
  const tempDir = await mkdtemp(path.join(repoRootDir, ".tmp-fix-pr-"));
  const relativePath = path.relative(repoRootDir, path.join(tempDir, "example.ts"));

  try {
    await writeFile(
      path.join(tempDir, "example.ts"),
      "const value = 'before';\nconst mirror = 'before';\n",
      "utf8",
    );

    await assert.rejects(
      () =>
        applyWorkspacePatch({
          fixerOutput: {
            summary: "ambiguous patch",
            patchPlan: "replace duplicated literal",
            riskNotes: [],
            cannotFixSafely: false,
          confidence: 0.8,
            changedFiles: [
              {
                filePath: relativePath,
                original: "'before'",
                updated: "'after'",
                explanation: "duplicate literal should be rejected",
              },
            ],
          },
        }),
      /matched multiple locations/,
    );

    const content = await readFile(path.join(tempDir, "example.ts"), "utf8");
    assert.equal(content, "const value = 'before';\nconst mirror = 'before';\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
