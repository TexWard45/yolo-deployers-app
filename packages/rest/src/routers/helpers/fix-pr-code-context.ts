import type { FixPrCodeContextOutput } from "@shared/types";

interface CodexFindingChunk {
  id?: string;
  filePath?: string;
  symbolName?: string;
  score?: number;
  matchChannel?: string;
}

interface CodexFindingsPayload {
  chunks?: CodexFindingChunk[];
}

interface RelevanceChunk {
  chunkId: string;
  filePath: string;
  symbolName?: string;
  matchChannel?: string;
  score: number;
}

interface RelevanceFile {
  filePath: string;
  maxScore: number;
  chunkCount: number;
  topChunkIds: string[];
}

export interface CodexFindingsRelevance {
  totalChunks: number;
  topChunks: RelevanceChunk[];
  topFiles: RelevanceFile[];
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

export function summarizeCodexFindingsRelevance(
  codexFindings: unknown,
  options: { topChunks?: number; topChunkIdsPerFile?: number } = {},
): CodexFindingsRelevance | null {
  const { topChunks = 20, topChunkIdsPerFile = 3 } = options;
  const chunks = (codexFindings as CodexFindingsPayload | null)?.chunks ?? [];
  const normalized: RelevanceChunk[] = [];

  for (const chunk of chunks) {
    const filePath = chunk.filePath?.trim();
    if (!filePath) {
      continue;
    }

    const chunkId = chunk.id?.trim();
    if (!chunkId) {
      continue;
    }

    const rawScore = chunk.score;
    const score = typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : 0;
    const symbolName = chunk.symbolName?.trim();
    const matchChannel = chunk.matchChannel?.trim();

    normalized.push({
      chunkId,
      filePath,
      ...(symbolName && symbolName.length > 0 ? { symbolName } : {}),
      ...(matchChannel && matchChannel.length > 0 ? { matchChannel } : {}),
      score,
    } as RelevanceChunk);
  }

  if (normalized.length === 0) {
    return null;
  }

  const sortedChunks = [...normalized].sort((a, b) => b.score - a.score);
  const topChunkList = sortedChunks.slice(0, Math.max(1, topChunks));

  const fileSummary = new Map<string, { maxScore: number; chunkIds: Set<string>; chunkCount: number }>();

  for (const chunk of sortedChunks) {
    const existing = fileSummary.get(chunk.filePath) ?? {
      maxScore: chunk.score,
      chunkIds: new Set<string>(),
      chunkCount: 0,
    };

    existing.chunkCount += 1;
    existing.maxScore = Math.max(existing.maxScore, chunk.score);
    existing.chunkIds.add(chunk.chunkId);

    fileSummary.set(chunk.filePath, existing);
  }

  const topFiles = [...fileSummary.entries()]
    .sort((a, b) => b[1].maxScore - a[1].maxScore)
    .map(([filePath, value]) => ({
      filePath,
      maxScore: value.maxScore,
      chunkCount: value.chunkCount,
      topChunkIds: [...value.chunkIds].slice(0, topChunkIdsPerFile),
    }));

  return {
    totalChunks: normalized.length,
    topChunks: topChunkList,
    topFiles,
  };
}
