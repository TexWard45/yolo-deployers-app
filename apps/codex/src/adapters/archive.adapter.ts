import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, basename } from "node:path";
import { Readable } from "node:stream";

const execFileAsync = promisify(execFile);
import type { CodexSourceType } from "@shared/types";
import type { CloneResult, ISourceAdapter, PullResult } from "./types.js";

export class ArchiveAdapter implements ISourceAdapter {
  readonly sourceType: CodexSourceType = "ARCHIVE";

  async clone(opts: {
    sourceUrl: string;
    branch: string;
    targetPath: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<CloneResult> {
    await mkdir(opts.targetPath, { recursive: true });

    const archivePath = await this.downloadArchive(
      opts.sourceUrl,
      opts.targetPath,
      opts.credentials
    );

    await this.extractArchive(archivePath, opts.targetPath);

    // Clean up the downloaded archive file
    await rm(archivePath, { force: true });

    // Flatten if the archive extracted into a single subdirectory
    await this.flattenSingleSubdir(opts.targetPath);

    return {
      localPath: opts.targetPath,
      // Archives have no git history — use a hash of the source URL as a pseudo-commit
      headCommit: this.hashString(opts.sourceUrl + Date.now().toString()),
      branch: opts.branch || "archive",
    };
  }

  async pull(opts: {
    localPath: string;
    branch: string;
    previousCommit: string;
    credentials?: Record<string, unknown> | null;
  }): Promise<PullResult> {
    // For archives, "pull" means re-download and replace all files.
    // We can't diff, so report all files as changed.
    await rm(opts.localPath, { recursive: true, force: true });
    await mkdir(opts.localPath, { recursive: true });

    // We don't have the sourceUrl in pull opts — the caller must re-trigger a full clone.
    // Return empty changeset; the workflow treats this as a full re-index.
    return {
      headCommit: this.hashString(opts.localPath + Date.now().toString()),
      previousCommit: opts.previousCommit,
      changedFiles: [],
      branch: opts.branch || "archive",
    };
  }

  private async downloadArchive(
    sourceUrl: string,
    targetDir: string,
    credentials?: Record<string, unknown> | null
  ): Promise<string> {
    const headers: Record<string, string> = {};

    if (credentials) {
      const token = credentials["token"] as string | undefined;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const response = await fetch(sourceUrl, { headers });
    if (!response.ok) {
      throw new Error(
        `Failed to download archive from ${sourceUrl}: ${response.status} ${response.statusText}`
      );
    }

    const filename = this.getFilename(sourceUrl, response);
    const archivePath = join(targetDir, filename);

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const nodeStream = Readable.fromWeb(
      response.body as Parameters<typeof Readable.fromWeb>[0]
    );
    const writeStream = createWriteStream(archivePath);
    await pipeline(nodeStream, writeStream);

    return archivePath;
  }

  private async extractArchive(
    archivePath: string,
    targetDir: string
  ): Promise<void> {
    const lowerPath = archivePath.toLowerCase();

    if (lowerPath.endsWith(".tar.gz") || lowerPath.endsWith(".tgz")) {
      await this.extractTarGz(archivePath, targetDir);
    } else if (lowerPath.endsWith(".zip")) {
      await this.extractZip(archivePath, targetDir);
    } else if (lowerPath.endsWith(".tar")) {
      await this.extractTar(archivePath, targetDir);
    } else {
      throw new Error(
        `Unsupported archive format: ${basename(archivePath)}. Supported: .zip, .tar.gz, .tgz, .tar`
      );
    }
  }

  private async extractTarGz(
    archivePath: string,
    targetDir: string
  ): Promise<void> {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", targetDir]);
  }

  private async extractTar(
    archivePath: string,
    targetDir: string
  ): Promise<void> {
    await execFileAsync("tar", ["-xf", archivePath, "-C", targetDir]);
  }

  private async extractZip(
    archivePath: string,
    targetDir: string
  ): Promise<void> {
    try {
      // Try system unzip first (available on most Linux/macOS systems)
      await execFileAsync("unzip", ["-o", archivePath, "-d", targetDir]);
    } catch {
      // Fallback: try PowerShell on Windows
      try {
        await execFileAsync("powershell", [
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}' -Force`,
        ]);
      } catch {
        throw new Error(
          "No unzip utility found. Install unzip or ensure PowerShell is available."
        );
      }
    }
  }

  /**
   * If the archive extracted into a single subdirectory, move its contents up.
   * E.g., repo-main/ → contents moved to targetDir directly.
   */
  private async flattenSingleSubdir(targetDir: string): Promise<void> {
    const entries = await readdir(targetDir);
    if (entries.length !== 1) return;

    const singleEntry = join(targetDir, entries[0]!);
    const entryStat = await stat(singleEntry);
    if (!entryStat.isDirectory()) return;

    const innerEntries = await readdir(singleEntry);
    for (const inner of innerEntries) {
      await rename(join(singleEntry, inner), join(targetDir, inner));
    }
    await rm(singleEntry, { recursive: true, force: true });
  }

  private getFilename(
    sourceUrl: string,
    response: Response
  ): string {
    // Try Content-Disposition header
    const disposition = response.headers.get("content-disposition");
    if (disposition) {
      const match = /filename[^;=\n]*=["']?([^"';\n]*)/.exec(disposition);
      if (match?.[1]) return match[1];
    }

    // Fall back to URL path
    const urlPath = new URL(sourceUrl).pathname;
    const name = basename(urlPath);
    if (name && name.includes(".")) return name;

    // Default
    return "archive.tar.gz";
  }

  private hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}
