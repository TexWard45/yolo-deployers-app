import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "@shared/database";
import type { CodexChunkType } from "@shared/types";
import { parseFile, isLanguageSupported } from "../parser/tree-sitter.js";
import { parseRawTextFile } from "../parser/raw-text-parser.js";
import { isBinaryExtension, contentLooksBinary } from "../parser/binary-detect.js";
import type { ParsedChunk } from "../parser/types.js";

export interface ParseFileInput {
  repositoryId: string;
  localPath: string;
  filePath: string;
  headCommit: string;
}

export interface ParseFileResult {
  filePath: string;
  chunksCreated: number;
  chunksUpdated: number;
  chunksDeleted: number;
  skipped: boolean;
}

/**
 * Parse a single file: read content, run Tree-sitter AST parser,
 * then diff chunks by content hash and upsert CodexFile + CodexChunk rows.
 */
export async function parseFileActivity(
  input: ParseFileInput,
): Promise<ParseFileResult> {
  const { repositoryId, localPath, filePath, headCommit } = input;

  // Load repository config for filtering
  const repo = await prisma.codexRepository.findUniqueOrThrow({
    where: { id: repositoryId },
    select: {
      extensionAllowlist: true,
      pathDenylist: true,
      maxFileSizeBytes: true,
    },
  });

  const ext = extname(filePath).toLowerCase();
  const language = ext.replace(".", "");
  const treeSitterSupported = isLanguageSupported(language);

  // Skip binary files by extension
  if (isBinaryExtension(ext)) {
    return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
  }

  // Apply extension allowlist filter
  if (repo.extensionAllowlist.length > 0 && !repo.extensionAllowlist.includes(ext)) {
    return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
  }

  // Apply path denylist filter
  for (const deny of repo.pathDenylist) {
    if (filePath.startsWith(deny) || filePath.includes(`/${deny}`)) {
      return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
    }
  }

  // Read file content
  const absolutePath = join(localPath, filePath);
  let content: string;
  try {
    content = await readFile(absolutePath, "utf-8");
  } catch {
    return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
  }

  // Skip files exceeding size limit
  if (Buffer.byteLength(content, "utf-8") > repo.maxFileSizeBytes) {
    return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
  }

  // Skip binary content (files with unknown extensions that contain null bytes)
  if (contentLooksBinary(Buffer.from(content.slice(0, 8192)))) {
    return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
  }

  const fileContentHash = createHash("sha256").update(content).digest("hex");

  // Upsert CodexFile
  const existingFile = await prisma.codexFile.findUnique({
    where: { repositoryId_filePath: { repositoryId, filePath } },
    select: { id: true, contentHash: true },
  });

  // If content hash unchanged, skip parsing entirely
  if (existingFile && existingFile.contentHash === fileContentHash) {
    return { filePath, chunksCreated: 0, chunksUpdated: 0, chunksDeleted: 0, skipped: true };
  }

  const codexFile = await prisma.codexFile.upsert({
    where: { repositoryId_filePath: { repositoryId, filePath } },
    create: {
      repositoryId,
      filePath,
      language,
      contentHash: fileContentHash,
      lastCommitSha: headCommit,
      lastCommitAt: new Date(),
    },
    update: {
      language,
      contentHash: fileContentHash,
      lastCommitSha: headCommit,
      lastCommitAt: new Date(),
    },
  });

  // Parse file into chunks — Tree-sitter for supported languages, raw text for others
  const parsedChunks = treeSitterSupported
    ? await parseFile(content, language)
    : parseRawTextFile(content, filePath);

  // Flatten chunks (including children) for DB operations
  const flatChunks = flattenChunks(parsedChunks);

  // Get existing chunks for this file
  const existingChunks = await prisma.codexChunk.findMany({
    where: { fileId: codexFile.id },
    select: { id: true, contentHash: true, symbolName: true, chunkType: true, lineStart: true },
  });

  const existingByHash = new Map(existingChunks.map((c) => [`${c.contentHash}`, c]));
  const newHashes = new Set(flatChunks.map((c) => c.contentHash));

  let chunksCreated = 0;
  let chunksUpdated = 0;
  let chunksDeleted = 0;

  // Delete chunks no longer present
  const toDelete = existingChunks.filter((c) => !newHashes.has(c.contentHash));
  if (toDelete.length > 0) {
    await prisma.codexChunk.deleteMany({
      where: { id: { in: toDelete.map((c) => c.id) } },
    });
    chunksDeleted = toDelete.length;
  }

  // Create a map to track parent chunk IDs for hierarchy
  const parentIdMap = new Map<string, string>();

  // Upsert chunks — first pass: top-level chunks (no parent)
  for (const chunk of flatChunks.filter((c) => !c.parentKey)) {
    const existing = existingByHash.get(chunk.contentHash);

    if (existing) {
      // Content unchanged — update position metadata only if needed
      parentIdMap.set(chunkKey(chunk), existing.id);
      continue;
    }

    const created = await prisma.codexChunk.create({
      data: {
        fileId: codexFile.id,
        chunkType: chunk.chunkType as CodexChunkType,
        symbolName: chunk.symbolName,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        content: chunk.content,
        contentHash: chunk.contentHash,
        parameters: chunk.parameters,
        returnType: chunk.returnType,
        imports: chunk.imports,
        exportType: chunk.exportType,
        isAsync: chunk.isAsync,
        docstring: chunk.docstring,
        embeddingStatus: "PENDING",
      },
    });
    parentIdMap.set(chunkKey(chunk), created.id);
    chunksCreated++;
  }

  // Second pass: child chunks (with parent)
  for (const chunk of flatChunks.filter((c) => c.parentKey)) {
    const existing = existingByHash.get(chunk.contentHash);
    const parentDbId = chunk.parentKey ? parentIdMap.get(chunk.parentKey) : undefined;

    if (existing) {
      parentIdMap.set(chunkKey(chunk), existing.id);
      // Update parent reference if changed
      if (parentDbId) {
        await prisma.codexChunk.update({
          where: { id: existing.id },
          data: { parentChunkId: parentDbId },
        });
        chunksUpdated++;
      }
      continue;
    }

    const created = await prisma.codexChunk.create({
      data: {
        fileId: codexFile.id,
        chunkType: chunk.chunkType as CodexChunkType,
        symbolName: chunk.symbolName,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        content: chunk.content,
        contentHash: chunk.contentHash,
        parameters: chunk.parameters,
        returnType: chunk.returnType,
        imports: chunk.imports,
        exportType: chunk.exportType,
        isAsync: chunk.isAsync,
        docstring: chunk.docstring,
        parentChunkId: parentDbId ?? null,
        embeddingStatus: "PENDING",
      },
    });
    parentIdMap.set(chunkKey(chunk), created.id);
    chunksCreated++;
  }

  return { filePath, chunksCreated, chunksUpdated, chunksDeleted, skipped: false };
}

// ── Helpers ──────────────────────────────────────────────────────────

interface FlatChunk {
  chunkType: string;
  symbolName: string | null;
  lineStart: number;
  lineEnd: number;
  content: string;
  contentHash: string;
  parameters: string[];
  returnType: string | null;
  imports: string[];
  exportType: string;
  isAsync: boolean;
  docstring: string | null;
  parentKey?: string;
}

function chunkKey(chunk: { chunkType: string; symbolName: string | null; lineStart: number }): string {
  return `${chunk.chunkType}:${chunk.symbolName ?? "anon"}:${chunk.lineStart}`;
}

function flattenChunks(chunks: ParsedChunk[], parentKey?: string): FlatChunk[] {
  const result: FlatChunk[] = [];
  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    result.push({
      chunkType: chunk.chunkType,
      symbolName: chunk.symbolName,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      content: chunk.content,
      contentHash: chunk.contentHash,
      parameters: chunk.parameters,
      returnType: chunk.returnType,
      imports: chunk.imports,
      exportType: chunk.exportType,
      isAsync: chunk.isAsync,
      docstring: chunk.docstring,
      parentKey,
    });

    if (chunk.children.length > 0) {
      result.push(...flattenChunks(chunk.children, key));
    }
  }
  return result;
}
