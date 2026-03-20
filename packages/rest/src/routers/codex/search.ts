import { Prisma } from "@shared/types/prisma";
import type { PrismaClient } from "@shared/types/prisma";
import type { CodexSearchInput } from "@shared/types";
import { rerank } from "./reranker";

// ── Types ────────────────────────────────────────────────────────────

export interface SearchChunkRow {
  id: string;
  content: string;
  symbolName: string | null;
  chunkType: string;
  lineStart: number;
  lineEnd: number;
  filePath: string;
  language: string;
  lastAuthor: string | null;
  lastCommitSha: string | null;
  lastCommitAt: Date | null;
  repoId: string;
  displayName: string;
  sourceType: string;
}

interface ChannelResult {
  id: string;
  score: number;
  row: SearchChunkRow;
}

export interface CodexSearchResult {
  chunks: Array<
    SearchChunkRow & {
      score: number;
      matchChannel: string;
    }
  >;
  total: number;
  query: string;
  timing: {
    semanticMs: number;
    keywordMs: number;
    symbolMs: number;
    rerankMs: number | null;
    totalMs: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

const SELECT_COLUMNS = Prisma.sql`
  c.id,
  c.content,
  c."symbolName",
  c."chunkType"::text as "chunkType",
  c."lineStart",
  c."lineEnd",
  f."filePath",
  f."language",
  f."lastAuthor",
  f."lastCommitSha",
  f."lastCommitAt",
  r.id as "repoId",
  r."displayName",
  r."sourceType"::text as "sourceType"
`;

const FROM_JOINS = Prisma.sql`
  FROM "CodexChunk" c
  JOIN "CodexFile" f ON c."fileId" = f.id
  JOIN "CodexRepository" r ON f."repositoryId" = r.id
`;

function buildFilterFragment(input: CodexSearchInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.empty];

  if (input.repositoryIds && input.repositoryIds.length > 0) {
    parts.push(
      Prisma.sql`AND f."repositoryId" IN (${Prisma.join(input.repositoryIds)})`,
    );
  }

  if (input.languages && input.languages.length > 0) {
    parts.push(
      Prisma.sql`AND f."language" IN (${Prisma.join(input.languages)})`,
    );
  }

  if (input.chunkTypes && input.chunkTypes.length > 0) {
    parts.push(
      Prisma.sql`AND c."chunkType"::text IN (${Prisma.join(input.chunkTypes)})`,
    );
  }

  return Prisma.join(parts, " ");
}

function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  return fn().then((result) => [result, performance.now() - start]);
}

function toRow(raw: SearchChunkRow): SearchChunkRow {
  return {
    id: raw.id,
    content: raw.content,
    symbolName: raw.symbolName,
    chunkType: raw.chunkType,
    lineStart: raw.lineStart,
    lineEnd: raw.lineEnd,
    filePath: raw.filePath,
    language: raw.language,
    lastAuthor: raw.lastAuthor,
    lastCommitSha: raw.lastCommitSha,
    lastCommitAt: raw.lastCommitAt,
    repoId: raw.repoId,
    displayName: raw.displayName,
    sourceType: raw.sourceType,
  };
}

// ── Semantic Search ──────────────────────────────────────────────────

export async function semanticSearch(
  prisma: PrismaClient,
  input: CodexSearchInput,
  queryEmbedding: number[],
  topK: number,
): Promise<ChannelResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const filters = buildFilterFragment(input);

  const query = Prisma.sql`
    SELECT
      ${SELECT_COLUMNS},
      (1 - (c.embedding <=> ${embeddingStr}::vector)) as similarity
    ${FROM_JOINS}
    WHERE c."embeddingStatus" = 'EMBEDDED'
      AND r."workspaceId" = ${input.workspaceId}
      ${filters}
      AND (1 - (c.embedding <=> ${embeddingStr}::vector)) > 0.3
    ORDER BY similarity DESC
    LIMIT ${topK}
  `;

  const rows = await prisma.$queryRaw<
    Array<SearchChunkRow & { similarity: number }>
  >(query);

  return rows.map((row) => ({
    id: row.id,
    score: Number(row.similarity),
    row: toRow(row),
  }));
}

// ── Keyword Search (Full-Text) ───────────────────────────────────────

export async function keywordSearch(
  prisma: PrismaClient,
  input: CodexSearchInput,
  topK: number,
): Promise<ChannelResult[]> {
  const filters = buildFilterFragment(input);

  const query = Prisma.sql`
    SELECT
      ${SELECT_COLUMNS},
      ts_rank(c."searchVector", websearch_to_tsquery('english', ${input.query})) as rank
    ${FROM_JOINS}
    WHERE c."searchVector" @@ websearch_to_tsquery('english', ${input.query})
      AND r."workspaceId" = ${input.workspaceId}
      ${filters}
    ORDER BY rank DESC
    LIMIT ${topK}
  `;

  const rows = await prisma.$queryRaw<
    Array<SearchChunkRow & { rank: number }>
  >(query);

  return rows.map((row) => ({
    id: row.id,
    score: Number(row.rank),
    row: toRow(row),
  }));
}

// ── Symbol Search ────────────────────────────────────────────────────

export async function symbolSearch(
  prisma: PrismaClient,
  input: CodexSearchInput,
  topK: number,
): Promise<ChannelResult[]> {
  const symbolQuery = input.symbolName ?? input.query;

  const results = await prisma.codexChunk.findMany({
    where: {
      file: {
        repository: {
          workspaceId: input.workspaceId,
          ...(input.repositoryIds && { id: { in: input.repositoryIds } }),
        },
        ...(input.languages && { language: { in: input.languages } }),
      },
      symbolName: input.symbolName
        ? input.symbolName
        : { contains: symbolQuery, mode: "insensitive" },
      ...(input.chunkTypes && { chunkType: { in: input.chunkTypes } }),
    },
    select: {
      id: true,
      content: true,
      symbolName: true,
      chunkType: true,
      lineStart: true,
      lineEnd: true,
      file: {
        select: {
          filePath: true,
          language: true,
          lastAuthor: true,
          lastCommitSha: true,
          lastCommitAt: true,
          repository: {
            select: {
              id: true,
              displayName: true,
              sourceType: true,
            },
          },
        },
      },
    },
    take: topK,
    orderBy: { symbolName: "asc" },
  });

  return results.map((chunk) => {
    const isExact =
      chunk.symbolName?.toLowerCase() === symbolQuery.toLowerCase();
    return {
      id: chunk.id,
      score: isExact ? 1.0 : 0.8,
      row: {
        id: chunk.id,
        content: chunk.content,
        symbolName: chunk.symbolName,
        chunkType: chunk.chunkType,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        filePath: chunk.file.filePath,
        language: chunk.file.language,
        lastAuthor: chunk.file.lastAuthor,
        lastCommitSha: chunk.file.lastCommitSha,
        lastCommitAt: chunk.file.lastCommitAt,
        repoId: chunk.file.repository.id,
        displayName: chunk.file.repository.displayName,
        sourceType: chunk.file.repository.sourceType,
      },
    };
  });
}

// ── Reciprocal Rank Fusion ───────────────────────────────────────────

const RRF_K = 60;

export function rrfFusion(
  channelResults: Map<string, ChannelResult[]>,
): Array<SearchChunkRow & { score: number; matchChannel: string }> {
  const scoreMap = new Map<
    string,
    { score: number; channels: string[]; row: SearchChunkRow }
  >();

  for (const [channel, results] of channelResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank]!;
      const rrfScore = 1 / (RRF_K + rank + 1);

      const existing = scoreMap.get(result.id);
      if (existing) {
        existing.score += rrfScore;
        existing.channels.push(channel);
      } else {
        scoreMap.set(result.id, {
          score: rrfScore,
          channels: [channel],
          row: result.row,
        });
      }
    }
  }

  const fused = Array.from(scoreMap.values()).sort(
    (a, b) => b.score - a.score,
  );

  const maxScore = fused[0]?.score ?? 1;

  return fused.map((item) => ({
    ...item.row,
    score: maxScore > 0 ? item.score / maxScore : 0,
    matchChannel: item.channels.join(","),
  }));
}

// ── Hybrid Search (Orchestrator) ─────────────────────────────────────

export interface EmbedQueryFn {
  (text: string): Promise<number[]>;
}

export async function hybridSearch(
  prisma: PrismaClient,
  input: CodexSearchInput,
  embedQuery: EmbedQueryFn,
): Promise<CodexSearchResult> {
  const totalStart = performance.now();

  const channels = {
    semantic: input.channels?.semantic ?? true,
    keyword: input.channels?.keyword ?? true,
    symbol: input.channels?.symbol ?? true,
  };

  const channelTopK = Math.max(input.limit * 3, 50);

  const channelPromises: Array<Promise<[string, ChannelResult[], number]>> = [];

  if (channels.semantic) {
    channelPromises.push(
      (async () => {
        const [embedding, embedMs] = await timed(() =>
          embedQuery(input.query),
        );
        const [results, searchMs] = await timed(() =>
          semanticSearch(prisma, input, embedding, channelTopK),
        );
        return ["semantic", results, embedMs + searchMs] as [
          string,
          ChannelResult[],
          number,
        ];
      })(),
    );
  }

  if (channels.keyword) {
    channelPromises.push(
      (async () => {
        const [results, ms] = await timed(() =>
          keywordSearch(prisma, input, channelTopK),
        );
        return ["keyword", results, ms] as [string, ChannelResult[], number];
      })(),
    );
  }

  if (channels.symbol) {
    channelPromises.push(
      (async () => {
        const [results, ms] = await timed(() =>
          symbolSearch(prisma, input, channelTopK),
        );
        return ["symbol", results, ms] as [string, ChannelResult[], number];
      })(),
    );
  }

  const channelOutputs = await Promise.all(channelPromises);

  const timing = {
    semanticMs: 0,
    keywordMs: 0,
    symbolMs: 0,
    rerankMs: null as number | null,
    totalMs: 0,
  };

  const channelResultsMap = new Map<string, ChannelResult[]>();

  for (const [name, results, ms] of channelOutputs) {
    channelResultsMap.set(name, results);
    if (name === "semantic") timing.semanticMs = Math.round(ms);
    if (name === "keyword") timing.keywordMs = Math.round(ms);
    if (name === "symbol") timing.symbolMs = Math.round(ms);
  }

  let fused = rrfFusion(channelResultsMap);

  if (input.rerank && fused.length > 0) {
    const [reranked, rerankMs] = await timed(() =>
      rerank(input.query, fused.slice(0, 50)),
    );
    timing.rerankMs = Math.round(rerankMs);
    fused = reranked;
  }

  const total = fused.length;
  const paginated = fused.slice(input.offset, input.offset + input.limit);

  timing.totalMs = Math.round(performance.now() - totalStart);

  return {
    chunks: paginated,
    total,
    query: input.query,
    timing,
  };
}
