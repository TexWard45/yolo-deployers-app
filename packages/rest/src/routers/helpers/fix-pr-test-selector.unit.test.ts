import assert from "node:assert/strict";
import test from "node:test";
import { buildFixPrTestPlan } from "./fix-pr-test-selector";

test("buildFixPrTestPlan selects workspace-specific commands", () => {
  const result = buildFixPrTestPlan({
    filePaths: [
      "apps/web/src/app/page.tsx",
      "apps/codex/src/workflows/generate-fix-pr.workflow.ts",
    ],
    requiredChecks: ["build-web"],
  });

  assert.ok(result.commands.includes("npm run type-check"));
  assert.ok(result.commands.includes("npm run build --workspace @app/web"));
  assert.ok(result.commands.includes("npm run build --workspace @app/codex"));
  assert.ok(result.requiredChecks.includes("build-web"));
});
