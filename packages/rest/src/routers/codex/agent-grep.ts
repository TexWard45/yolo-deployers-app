import type { PrismaClient } from "@shared/types/prisma";
import type OpenAI from "openai";
import type {
  AgentGrepInput,
  AgentGrepResult,
  AgentGrepContextCheckInput,
  AgentGrepContextCheckResult,
} from "@shared/types";
import { hybridSearch } from "./search";
import type { EmbedQueryFn, SearchChunkRow } from "./search";
import { llmSummarizeTask } from "./agent-grep.prompt";

// ── Helpers ──────────────────────────────────────────────────────────

function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  return fn().then((result) => [result, Math.round(performance.now() - start)]);
}

function mergeChannels(existing: string, incoming: string): string {
  const channels = new Set([...existing.split(","), ...incoming.split(",")]);
  return Array.from(channels).join(",");
}

// ── Context Check ───────────────────────────────────────────────────

export async function checkRepositoryContext(
  prisma: PrismaClient,
  input: AgentGrepContextCheckInput,
): Promise<AgentGrepContextCheckResult> {
  const repo = await prisma.codexRepository.findUnique({
    where: { id: input.repositoryId },
    select: {
      id: true,
      workspaceId: true,
      displayName: true,
      syncStatus: true,
    },
  });

  if (!repo || repo.workspaceId !== input.workspaceId) {
    return {
      ready: false,
      repositoryExists: false,
      displayName: null,
      totalChunks: 0,
      embeddedChunks: 0,
      embeddingCoverage: 0,
      syncStatus: null,
    };
  }

  const [totalChunks, embeddedChunks] = await Promise.all([
    prisma.codexChunk.count({
      where: { file: { repositoryId: input.repositoryId } },
    }),
    prisma.codexChunk.count({
      where: {
        file: { repositoryId: input.repositoryId },
        embeddingStatus: "EMBEDDED",
      },
    }),
  ]);

  const embeddingCoverage = totalChunks > 0 ? embeddedChunks / totalChunks : 0;

  return {
    ready: embeddedChunks > 0,
    repositoryExists: true,
    displayName: repo.displayName,
    totalChunks,
    embeddedChunks,
    embeddingCoverage,
    syncStatus: repo.syncStatus,
  };
}

// ── Grep Relevant Code ──────────────────────────────────────────────

export async function grepRelevantCode(
  prisma: PrismaClient,
  input: AgentGrepInput,
  embedQuery: EmbedQueryFn,
  openaiClient: OpenAI,
): Promise<AgentGrepResult> {
  const totalStart = performance.now();

  // Phase 1: LLM summarize + context check in parallel
  const [[summarizeResult, summarizeMs], [context, contextCheckMs]] =
    await Promise.all([
      timed(() => llmSummarizeTask(input.taskDescription, openaiClient)),
      timed(() =>
        checkRepositoryContext(prisma, {
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
        }),
      ),
    ]);

  // Fallback if LLM fails
  const summary = summarizeResult ?? {
    summary: input.taskDescription,
    semanticQueries: [input.taskDescription],
    keywords: input.taskDescription
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 10),
    symbolNames: [],
  };

  // Early return if repo not ready
  if (!context.ready) {
    return {
      summary,
      context,
      chunks: [],
      totalFound: 0,
      timing: {
        summarizeMs,
        contextCheckMs,
        searchMs: 0,
        totalMs: Math.round(performance.now() - totalStart),
      },
    };
  }

  // Phase 2: Run multiple search queries in parallel
  const searchStart = performance.now();

  // NOTE: We intentionally do NOT pass summary.languages or summary.chunkTypes
  // as filters. The LLM guesses these from the task description but can't know
  // what's actually indexed (e.g. it guesses "typescript" for a Java repo).
  // The repositoryIds scope is sufficient — let all channels return broadly.
  const baseInput = {
    workspaceId: input.workspaceId,
    repositoryIds: [input.repositoryId],
    rerank: input.rerank ?? false,
    limit: 20,
    offset: 0,
  };

  const searchPromises: Array<
    Promise<Array<SearchChunkRow & { score: number; matchChannel: string }>>
  > = [];

  // Semantic queries — one per query, semantic channel only
  for (const query of summary.semanticQueries) {
    searchPromises.push(
      hybridSearch(
        prisma,
        {
          ...baseInput,
          query,
          channels: { semantic: true, keyword: false, symbol: false },
        },
        embedQuery,
      ).then((r) => r.chunks),
    );
  }

  // Keywords — combined into one query, keyword channel only
  if (summary.keywords.length > 0) {
    searchPromises.push(
      hybridSearch(
        prisma,
        {
          ...baseInput,
          query: summary.keywords.join(" "),
          channels: { semantic: false, keyword: true, symbol: false },
        },
        embedQuery,
      ).then((r) => r.chunks),
    );
  }

  // Symbol names — one per symbol, symbol channel only
  for (const symbolName of summary.symbolNames) {
    searchPromises.push(
      hybridSearch(
        prisma,
        {
          ...baseInput,
          query: symbolName,
          symbolName,
          channels: { semantic: false, keyword: false, symbol: true },
        },
        embedQuery,
      ).then((r) => r.chunks),
    );
  }

  const allResults = await Promise.all(searchPromises);
  const searchMs = Math.round(performance.now() - searchStart);


  // Phase 3: Deduplicate by chunk ID, keep highest score
  const chunkMap = new Map<
    string,
    SearchChunkRow & { score: number; matchChannel: string }
  >();

  for (const results of allResults) {
    for (const chunk of results) {
      const existing = chunkMap.get(chunk.id);
      if (!existing || chunk.score > existing.score) {
        const mergedChannel = existing
          ? mergeChannels(existing.matchChannel, chunk.matchChannel)
          : chunk.matchChannel;
        chunkMap.set(chunk.id, { ...chunk, matchChannel: mergedChannel });
      } else if (existing) {
        existing.matchChannel = mergeChannels(
          existing.matchChannel,
          chunk.matchChannel,
        );
      }
    }
  }

  // Sort by score descending, take top maxResults
  const sorted = Array.from(chunkMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, input.maxResults);

  return {
    summary,
    context,
    chunks: sorted,
    totalFound: chunkMap.size,
    timing: {
      summarizeMs,
      contextCheckMs,
      searchMs,
      totalMs: Math.round(performance.now() - totalStart),
    },
  };
}
