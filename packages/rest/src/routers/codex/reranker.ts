import type { SearchChunkRow } from "./search";

type FusedResult = SearchChunkRow & { score: number; matchChannel: string };

/**
 * Optional cross-encoder reranker.
 *
 * Stub implementation: returns candidates unchanged.
 * Replace with Cohere Rerank, Voyage, or a self-hosted cross-encoder
 * when CODEX_RERANKER_ENABLED is true.
 */
export async function rerank(
  _query: string,
  candidates: FusedResult[],
): Promise<FusedResult[]> {
  // TODO: integrate cross-encoder reranking API
  // Example providers: Cohere Rerank v3, Voyage reranker, Jina reranker
  //
  // const response = await cohereClient.rerank({
  //   model: "rerank-english-v3.0",
  //   query,
  //   documents: candidates.map(c => c.content),
  //   topN: candidates.length,
  // });
  //
  // return response.results
  //   .sort((a, b) => b.relevanceScore - a.relevanceScore)
  //   .map(r => ({
  //     ...candidates[r.index],
  //     score: r.relevanceScore,
  //   }));

  return candidates;
}
