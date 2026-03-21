import assert from "node:assert/strict";
import test from "node:test";
import { generateCodexFix } from "./codex-fix.prompt";
import { reviewCodexFix } from "./codex-review.prompt";
import { generateFixPrRca } from "./fix-pr-rca.prompt";

test("generateCodexFix returns a safe fallback when no LLM API key is configured", async () => {
  const result = await generateCodexFix(
    {
      rca: {
        summary: "Null access in request handling",
        hypotheses: [],
        confidence: 0.72,
        likelyFiles: ["apps/web/src/app.tsx"],
        evidence: [],
        insufficientEvidence: false,
      },
      codeContext: {
        files: [
          {
            filePath: "apps/web/src/app.tsx",
            symbolNames: ["App"],
            chunkIds: ["chunk-1"],
          },
        ],
        symbols: ["App"],
        relatedChunks: ["chunk-1"],
        editScope: ["apps/web/src/app.tsx"],
      },
      testPlan: {
        commands: ["npm run type-check"],
        requiredChecks: [],
        rationale: "Minimum validation",
      },
      fileContents: [
        {
          filePath: "apps/web/src/app.tsx",
          content: "export function App() { return null; }",
        },
      ],
      priorFailures: [],
    },
    { apiKey: null },
  );

  assert.equal(result.cannotFixSafely, true);
  assert.deepEqual(result.changedFiles, []);
  assert.match(result.summary, /LLM API key missing/i);
});

test("reviewCodexFix approves unchanged fallback review only when there is a patch to inspect", async () => {
  const withPatch = await reviewCodexFix(
    {
      rcaSummary: "Guard missing around optional payload",
      changedFiles: [
        {
          filePath: "packages/rest/src/routers/agent.ts",
          diff: "--- original\nbefore\n+++ updated\nafter",
        },
      ],
      testPlan: ["npm run type-check"],
    },
    { apiKey: null },
  );

  const withoutPatch = await reviewCodexFix(
    {
      rcaSummary: "Guard missing around optional payload",
      changedFiles: [],
      testPlan: ["npm run type-check"],
    },
    { apiKey: null },
  );

  assert.equal(withPatch.approved, true);
  assert.equal(withPatch.blockers.length, 0);
  assert.equal(withoutPatch.approved, false);
  assert.equal(withoutPatch.blockers.length, 0);
});

test("generateFixPrRca falls back to thread analysis and bounded codex evidence when no API key is configured", async () => {
  const result = await generateFixPrRca(
    {
      analysisSummary: "Users hit an exception during inbox load",
      analysisRcaSummary: "Null handling bug in inbox state hydration",
      codexFindings: {
        chunks: [
          { id: "chunk-1", filePath: "apps/web/src/components/inbox/TriageSection.tsx" },
          { id: "chunk-2", filePath: "apps/web/src/actions/inbox.ts" },
          { id: "chunk-3", filePath: "apps/web/src/actions/inbox.ts" },
        ],
      },
      sentryFindings: [
        {
          issueId: "ISSUE-1",
          title: "TypeError: Cannot read properties of undefined",
          culprit: "apps/web/src/components/inbox/TriageSection.tsx",
          stackTrace: "TypeError at render",
        },
      ],
    },
    { apiKey: null },
  );

  assert.equal(result.summary, "Null handling bug in inbox state hydration");
  assert.equal(result.insufficientEvidence, false);
  assert.deepEqual(result.likelyFiles, [
    "apps/web/src/components/inbox/TriageSection.tsx",
    "apps/web/src/actions/inbox.ts",
  ]);
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.evidence[0]?.issueId, "ISSUE-1");
});
