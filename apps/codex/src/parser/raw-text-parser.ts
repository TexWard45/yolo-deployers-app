import type { ParsedChunk } from "./types.js";
import { splitLargeChunk, computeHash } from "./chunk-splitter.js";

/**
 * Create a ParsedChunk for a raw text file (non-Tree-sitter).
 * The entire file becomes a single FILE chunk; if it exceeds 200 lines,
 * it is automatically split into FRAGMENT children by the chunk splitter.
 */
export function parseRawTextFile(content: string, filePath: string): ParsedChunk[] {
  const lines = content.split("\n");

  const chunk: ParsedChunk = {
    chunkType: "FILE",
    symbolName: filePath.split("/").pop() ?? null,
    lineStart: 1,
    lineEnd: lines.length,
    content,
    contentHash: computeHash(content),
    parameters: [],
    returnType: null,
    imports: [],
    exportType: "none",
    isAsync: false,
    docstring: null,
    children: [],
  };

  // Split large files into fragments
  const processed = splitLargeChunk(chunk);

  return [processed];
}
