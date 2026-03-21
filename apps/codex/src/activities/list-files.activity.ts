import { access, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export interface ListFilesInput {
  localPath: string;
}

/**
 * Recursively list all files in a cloned repository.
 * Skips hidden directories (e.g. .git) and common non-source directories.
 */
export async function listRepositoryFiles(
  input: ListFilesInput,
): Promise<string[]> {
  await access(input.localPath).catch(() => {
    throw new Error(
      `Clone directory not found at "${input.localPath}". The clone activity may have failed or used a different path. Check CODEX_CLONE_BASE_PATH is an absolute path.`,
    );
  });

  const files: string[] = [];
  await walkDir(input.localPath, input.localPath, files);
  return files;
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "__pycache__",
  ".tox",
  "dist",
  "build",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  "vendor",
  ".turbo",
]);

async function walkDir(
  basePath: string,
  currentPath: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await walkDir(basePath, fullPath, files);
    } else if (entry.isFile()) {
      // Use forward slashes for consistent path representation
      const relativePath = relative(basePath, fullPath).replace(/\\/g, "/");
      files.push(relativePath);
    }
  }
}
