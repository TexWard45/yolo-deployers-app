import type { FixPrCodeContextOutput } from "@shared/types";

interface CodexFindingChunk {
  id?: string;
  filePath?: string;
  symbolName?: string;
}

interface CodexFindingsPayload {
  chunks?: CodexFindingChunk[];
}

export function expandFixPrCodeContext(
  codexFindings: unknown,
): FixPrCodeContextOutput {
  const chunks = (codexFindings as CodexFindingsPayload | null)?.chunks ?? [];
  const files = new Map<string, { symbolNames: Set<string>; chunkIds: Set<string> }>();
  const symbols = new Set<string>();
  const relatedChunks = new Set<string>();

  for (const chunk of chunks) {
    const filePath = chunk.filePath?.trim();
    if (!filePath) continue;

    const existing = files.get(filePath) ?? {
      symbolNames: new Set<string>(),
      chunkIds: new Set<string>(),
    };

    if (chunk.symbolName?.trim()) {
      existing.symbolNames.add(chunk.symbolName.trim());
      symbols.add(chunk.symbolName.trim());
    }

    if (chunk.id?.trim()) {
      existing.chunkIds.add(chunk.id.trim());
      relatedChunks.add(chunk.id.trim());
    }

    files.set(filePath, existing);
  }

  return {
    files: [...files.entries()].map(([filePath, value]) => ({
      filePath,
      symbolNames: [...value.symbolNames],
      chunkIds: [...value.chunkIds],
    })),
    symbols: [...symbols],
    relatedChunks: [...relatedChunks],
    editScope: [...files.keys()],
  };
}
