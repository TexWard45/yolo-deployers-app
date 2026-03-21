import type { FixPrTestPlan } from "@shared/types";

export function buildFixPrTestPlan(params: {
  filePaths: string[];
  requiredChecks?: string[];
}): FixPrTestPlan {
  const commands = new Set<string>();
  const requiredChecks = new Set<string>(params.requiredChecks ?? []);

  commands.add("npm run type-check");

  if (params.filePaths.some((filePath) => filePath.startsWith("apps/web/"))) {
    commands.add("npm run build --workspace @app/web");
    requiredChecks.add("build-web");
  }

  if (params.filePaths.some((filePath) => filePath.startsWith("apps/codex/"))) {
    commands.add("npm run build --workspace @app/codex");
  }

  if (params.filePaths.some((filePath) => filePath.startsWith("apps/queue/"))) {
    commands.add("npm run build --workspace @app/queue");
    requiredChecks.add("build-queue");
  }

  if (params.filePaths.some((filePath) => filePath.startsWith("packages/"))) {
    commands.add("npm run build");
  }

  return {
    commands: [...commands],
    requiredChecks: [...requiredChecks],
    rationale: "Selected the narrowest repo commands based on the files currently in scope.",
  };
}
