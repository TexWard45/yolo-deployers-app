import { CohereClientV2 } from "cohere-ai";
import type { SearchChunkRow } from "./search";

type FusedResult = SearchChunkRow & { score: number; matchChannel: string };

// ── Cohere client (lazy singleton) ──────────────────────────────────

let _cohereClient: CohereClientV2 | undefined;

function getCohereClient(): CohereClientV2 {
  if (!_cohereClient) {
    const token = process.env["COHERE_API_KEY"];
    if (!token) {
      throw new Error("COHERE_API_KEY is required for reranking");
    }
    _cohereClient = new CohereClientV2({ token });
  }
  return _cohereClient;
}

/**
 * Cross-encoder reranker using Cohere Rerank API.
 *
 * Re-scores RRF-fused results using a cross-encoder model for better precision.
 * Falls back to returning candidates unchanged if the API fails or times out.
 */
export async function rerank(
  query: string,
  candidates: FusedResult[],
): Promise<FusedResult[]> {
  if (candidates.length === 0) return candidates;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const client = getCohereClient();
    const model = process.env["CODEX_RERANKER_MODEL"] ?? "rerank-v3.5";

    const response = await client.rerank({
      model,
      query,
      documents: candidates.map((c) =>
        [c.filePath, c.symbolName ?? "", c.content].join("\n"),
      ),
      topN: candidates.length,
    });

    return response.results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map((r) => ({
        ...candidates[r.index]!,
        score: r.relevanceScore,
      }));
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[reranker] Cohere rerank timed out (5s), falling back to RRF results");
    } else {
      console.warn("[reranker] Cohere rerank failed, falling back to RRF results:", (error as Error).message);
    }
    return candidates;
  } finally {
    clearTimeout(timeout);
  }
}
