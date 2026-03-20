import { createHash } from "node:crypto";
import type { ParsedChunk } from "./types.js";

// ── Configuration ────────────────────────────────────────────────────

/** Maximum lines per chunk before splitting into fragments. */
const MAX_CHUNK_LINES = 200;

/** Overlap lines between adjacent fragments for context continuity. */
const FRAGMENT_OVERLAP = 10;

// ── Splitting ────────────────────────────────────────────────────────

/**
 * Split a single large chunk into FRAGMENT sub-chunks.
 * Returns the original chunk (with children set) plus fragment children.
 * If the chunk is within the line limit, returns it unmodified.
 */
export function splitLargeChunk(chunk: ParsedChunk): ParsedChunk {
  const lines = chunk.content.split("\n");
  if (lines.length <= MAX_CHUNK_LINES) return chunk;

  const fragments: ParsedChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    const end = Math.min(start + MAX_CHUNK_LINES, lines.length);
    const fragmentLines = lines.slice(start, end);
    const fragmentContent = fragmentLines.join("\n");

    fragments.push({
      chunkType: "FRAGMENT",
      symbolName: chunk.symbolName
        ? `${chunk.symbolName}$fragment_${fragments.length}`
        : `fragment_${fragments.length}`,
      lineStart: chunk.lineStart + start,
      lineEnd: chunk.lineStart + end - 1,
      content: fragmentContent,
      contentHash: computeHash(fragmentContent),
      parameters: [],
      returnType: null,
      imports: [],
      exportType: "none",
      isAsync: false,
      docstring: null,
      children: [],
    });

    // Advance with overlap
    start = end - FRAGMENT_OVERLAP;
    if (start >= lines.length) break;
    // Prevent infinite loop when overlap would not advance
    if (end === lines.length) break;
  }

  return {
    ...chunk,
    children: [...chunk.children, ...fragments],
  };
}

/**
 * Process all chunks: split any that exceed the line limit.
 */
export function splitLargeChunks(chunks: ParsedChunk[]): ParsedChunk[] {
  return chunks.map(splitLargeChunk);
}

// ── Hashing ──────────────────────────────────────────────────────────

export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
