import assert from "node:assert/strict";
import test from "node:test";
import { expandFixPrCodeContext } from "./fix-pr-code-context";

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
