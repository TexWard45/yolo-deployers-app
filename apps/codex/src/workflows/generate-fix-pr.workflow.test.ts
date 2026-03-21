import assert from "node:assert/strict";
import test from "node:test";
import { buildFailureSummary, collectFailureMessages } from "./generate-fix-pr.workflow.js";

test("collectFailureMessages combines reviewer blockers and failed commands", () => {
  const result = collectFailureMessages(
    {
      approved: false,
      blockers: [
        { severity: "blocker", message: "Missing null check", filePath: "apps/web/src/app.tsx" },
      ],
      warnings: [],
      notes: [],
      missingTests: [],
    },
    {
      passed: false,
      commandsRun: [],
      failures: ["npm run type-check"],
      logs: [],
    },
  );

  assert.deepEqual(result, ["Missing null check", "npm run type-check"]);
});

test("buildFailureSummary returns null when review and checks are clean", () => {
  const result = buildFailureSummary(
    {
      approved: true,
      blockers: [],
      warnings: [],
      notes: [],
      missingTests: [],
    },
    {
      passed: true,
      commandsRun: [],
      failures: [],
      logs: [],
    },
  );

  assert.equal(result, null);
});
