import assert from "node:assert/strict";
import test from "node:test";
import {
  expandFixPrCodeContext,
  summarizeCodexFindingsRelevance,
} from "./fix-pr-code-context";

test("expandFixPrCodeContext groups chunks by file and symbol", () => {
  const result = expandFixPrCodeContext({
    chunks: [
      { id: "chunk-1", filePath: "apps/web/src/app.tsx", symbolName: "App" },
      { id: "chunk-2", filePath: "apps/web/src/app.tsx", symbolName: "loadData" },
      { id: "chunk-3", filePath: "packages/rest/src/router.ts", symbolName: "router" },
    ],
  });

  assert.deepEqual(result.editScope, [
    "apps/web/src/app.tsx",
    "packages/rest/src/router.ts",
  ]);
  assert.ok(result.symbols.includes("App"));
  assert.ok(result.symbols.includes("router"));
  assert.equal(result.files.length, 2);
});

test("summarizeCodexFindingsRelevance sorts by score and groups by file", () => {
  const result = summarizeCodexFindingsRelevance({
    chunks: [
      { id: "chunk-1", filePath: "apps/web/src/app.tsx", symbolName: "App", score: 0.42, matchChannel: "semantic" },
      { id: "chunk-2", filePath: "apps/web/src/app.tsx", symbolName: "loadData", score: 0.9, matchChannel: "keyword" },
      { id: "chunk-3", filePath: "packages/rest/src/router.ts", symbolName: "router", score: 0.61 },
    ],
  });

  assert.ok(result !== null);
  assert.equal(result?.totalChunks, 3);
  assert.equal(result?.topChunks[0]?.chunkId, "chunk-2");
  assert.equal(result?.topFiles[0]?.filePath, "apps/web/src/app.tsx");
  assert.equal(result?.topFiles[0]?.maxScore, 0.9);
});
