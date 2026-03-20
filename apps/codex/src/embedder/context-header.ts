import type { CodexChunkType } from "@shared/types";

interface ChunkForHeader {
  chunkType: CodexChunkType;
  symbolName: string | null;
  parameters: string[];
  returnType: string | null;
  imports: string[];
  exportType: string | null;
  isAsync: boolean;
  docstring: string | null;
  filePath: string;
  language: string;
}

/**
 * Build a structured context header that prefixes chunk content before embedding.
 * This improves retrieval quality by giving the embedding model semantic context
 * about what the chunk is and where it lives.
 */
export function buildContextHeader(chunk: ChunkForHeader): string {
  const lines: string[] = [];

  // File location
  lines.push(`File: ${chunk.filePath}`);
  lines.push(`Language: ${chunk.language}`);

  // Chunk identity
  const typeLabel = formatChunkType(chunk.chunkType);
  const asyncPrefix = chunk.isAsync ? "async " : "";
  const exportPrefix = chunk.exportType === "default"
    ? "export default "
    : chunk.exportType === "named"
      ? "export "
      : "";

  if (chunk.symbolName) {
    lines.push(`${exportPrefix}${asyncPrefix}${typeLabel}: ${chunk.symbolName}`);
  } else {
    lines.push(`${exportPrefix}${asyncPrefix}${typeLabel}`);
  }

  // Signature
  if (chunk.parameters.length > 0) {
    lines.push(`Parameters: (${chunk.parameters.join(", ")})`);
  }

  if (chunk.returnType) {
    lines.push(`Returns: ${chunk.returnType}`);
  }

  // Docstring summary (first line only to keep header compact)
  if (chunk.docstring) {
    const firstLine = chunk.docstring.split("\n")[0]!.trim();
    if (firstLine) {
      lines.push(`Description: ${firstLine}`);
    }
  }

  // Key imports for context
  if (chunk.imports.length > 0) {
    const importSummary = chunk.imports.slice(0, 5).join(", ");
    lines.push(`Imports: ${importSummary}`);
  }

  return lines.join("\n");
}

function formatChunkType(type: CodexChunkType): string {
  switch (type) {
    case "FUNCTION": return "Function";
    case "METHOD": return "Method";
    case "CLASS": return "Class";
    case "TYPE": return "Type";
    case "INTERFACE": return "Interface";
    case "ENUM": return "Enum";
    case "ROUTE_HANDLER": return "Route Handler";
    case "MODULE": return "Module";
    case "FRAGMENT": return "Fragment";
    default: return type;
  }
}
