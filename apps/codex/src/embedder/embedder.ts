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
/** Conservative character limit — code averages ~2.5-3 chars/token, 8192 token max */
const MAX_INPUT_CHARS = 20000;

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

  const truncated = batch.map((r) =>
    r.text.length > MAX_INPUT_CHARS ? r.text.slice(0, MAX_INPUT_CHARS) : r.text,
  );

  try {
    const response = await openai.embeddings.create({
      model: codexConfig.embedding.model,
      input: truncated,
      dimensions: codexConfig.embedding.dimensions,
    });

    return response.data.map((item, index) => ({
      id: batch[index]!.id,
      embedding: item.embedding,
    }));
  } catch (error) {
    // If a batch fails due to token limit, fall back to one-at-a-time embedding
    // so one oversized item doesn't kill the entire batch
    if (error instanceof OpenAI.APIError && error.status === 400) {
      console.warn(
        `Batch of ${batch.length} failed with 400, falling back to individual embedding`,
      );
      return embedIndividually(batch, truncated);
    }
    throw error;
  }
}

async function embedIndividually(
  batch: EmbeddingRequest[],
  truncatedTexts: string[],
): Promise<EmbeddingResult[]> {
  const openai = getClient();
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < batch.length; i++) {
    try {
      const response = await openai.embeddings.create({
        model: codexConfig.embedding.model,
        input: truncatedTexts[i]!,
        dimensions: codexConfig.embedding.dimensions,
      });
      results.push({
        id: batch[i]!.id,
        embedding: response.data[0]!.embedding,
      });
    } catch (error) {
      if (error instanceof OpenAI.APIError && error.status === 400) {
        // This individual chunk is still too large — skip it
        console.warn(
          `Skipping chunk ${batch[i]!.id}: still exceeds token limit after truncation to ${truncatedTexts[i]!.length} chars`,
        );
        continue;
      }
      throw error;
    }
  }

  return results;
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
