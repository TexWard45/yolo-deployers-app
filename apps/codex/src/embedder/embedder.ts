import OpenAI from "openai";
import { codexConfig } from "../config.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: codexConfig.embedding.apiKey });
  }
  return client;
}

export interface EmbeddingRequest {
  id: string;
  text: string;
}

export interface EmbeddingResult {
  id: string;
  embedding: number[];
}

const MAX_BATCH_SIZE = 2048;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Generate embeddings for a batch of texts using OpenAI's embedding API.
 * Handles batching (max 2048 per request) and retry with exponential backoff.
 */
export async function generateEmbeddings(
  requests: EmbeddingRequest[],
): Promise<EmbeddingResult[]> {
  if (requests.length === 0) return [];

  const results: EmbeddingResult[] = [];

  // Process in batches of MAX_BATCH_SIZE
  for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
    const batch = requests.slice(i, i + MAX_BATCH_SIZE);
    const batchResults = await embedBatchWithRetry(batch);
    results.push(...batchResults);
  }

  return results;
}

async function embedBatchWithRetry(
  batch: EmbeddingRequest[],
): Promise<EmbeddingResult[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await embedBatch(batch);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 4xx errors (bad request, auth failure, etc.)
      if (isNonRetryableError(error)) {
        throw lastError;
      }

      if (attempt < MAX_RETRIES - 1) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoff);
      }
    }
  }

  throw lastError!;
}

async function embedBatch(
  batch: EmbeddingRequest[],
): Promise<EmbeddingResult[]> {
  const openai = getClient();

  const response = await openai.embeddings.create({
    model: codexConfig.embedding.model,
    input: batch.map((r) => r.text),
    dimensions: codexConfig.embedding.dimensions,
  });

  return response.data.map((item, index) => ({
    id: batch[index]!.id,
    embedding: item.embedding,
  }));
}

function isNonRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return error.status !== undefined && error.status >= 400 && error.status < 500;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
