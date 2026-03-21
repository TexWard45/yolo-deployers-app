import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url)); // apps/codex
const monorepoRoot = fileURLToPath(new URL("../../../", import.meta.url)); // repo root

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  process.loadEnvFile(filePath);
}

[
  // Current workspace and monorepo root.
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), ".env.local"),
  path.join(monorepoRoot, ".env"),
  path.join(monorepoRoot, ".env.local"),
  // Reuse web env so INTERNAL_API_SECRET stays consistent when running full stack.
  path.join(workspaceRoot, "..", "web", ".env"),
].forEach(loadEnvFile);

if (!process.env.INTERNAL_API_SECRET) {
  process.env.INTERNAL_API_SECRET = "local-codex-internal-secret";
  console.warn(
    "INTERNAL_API_SECRET was not set. Using local fallback; set INTERNAL_API_SECRET in your environment for production or webhook-secured callbacks.",
  );
}

if (!process.env.CODEX_EMBEDDING_API_KEY) {
  process.env.CODEX_EMBEDDING_API_KEY =
    process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "local-codex-embedding-key";
  console.warn(
    "CODEX_EMBEDDING_API_KEY was not set. Falling back to LLM_API_KEY/OPENAI_API_KEY or a local placeholder.",
  );
}

if (!process.env.CODEX_CLONE_BASE_PATH) {
  process.env.CODEX_CLONE_BASE_PATH = path.resolve(workspaceRoot, "data", "codex-repos");
  console.warn(
    "CODEX_CLONE_BASE_PATH was not set. Defaulting to data/codex-repos under apps/codex.",
  );
}
