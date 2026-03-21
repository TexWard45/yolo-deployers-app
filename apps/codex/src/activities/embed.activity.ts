import { prisma } from "@shared/database";
import { buildContextHeader } from "../embedder/context-header.js";
import { generateEmbeddings } from "../embedder/embedder.js";
import type { EmbeddingRequest } from "../embedder/embedder.js";
import { findPendingChunks, markChunksEmbedded, markChunksFailed } from "../embedder/diff.js";
import { updateSearchVectors } from "../embedder/tsvector.js";
import { codexConfig } from "../config.js";
import type { CodexChunkType } from "@shared/types";

export interface EmbedChunksInput {
  repositoryId: string;
}

export interface EmbedChunksResult {
  embeddingsGenerated: number;
  embeddingsFailed: number;
}

/** Batch size for embedding API calls within the activity */
const EMBED_BATCH_SIZE = 100;

/**
 * Embed all PENDING chunks for a repository:
 * 1. Load pending chunks from DB
 * 2. Build context headers for each
 * 3. Generate embeddings via OpenAI
 * 4. Write embeddings to DB via raw SQL (::vector cast)
 * 5. Update tsvector search column
 * 6. Mark chunks as EMBEDDED
 */
export async function embedChunksActivity(
  input: EmbedChunksInput,
): Promise<EmbedChunksResult> {
  const { repositoryId } = input;

  // Step 1: Find all PENDING chunks
  const pendingChunks = await findPendingChunks(repositoryId);

  if (pendingChunks.length === 0) {
    return { embeddingsGenerated: 0, embeddingsFailed: 0 };
  }

  let totalGenerated = 0;
  let totalFailed = 0;

  // Step 2-6: Process in batches
  for (let i = 0; i < pendingChunks.length; i += EMBED_BATCH_SIZE) {
    const batch = pendingChunks.slice(i, i + EMBED_BATCH_SIZE);

    // Build context-enriched text for each chunk
    const requests: EmbeddingRequest[] = batch.map((chunk) => {
      const header = buildContextHeader({
        chunkType: chunk.chunkType as CodexChunkType,
        symbolName: chunk.symbolName,
        parameters: chunk.parameters,
        returnType: chunk.returnType,
        imports: chunk.imports,
        exportType: chunk.exportType,
        isAsync: chunk.isAsync,
        docstring: chunk.docstring,
        filePath: chunk.file.filePath,
        language: chunk.file.language,
      });

      return {
        id: chunk.id,
        text: `${header}\n\n${chunk.content}`,
      };
    });

    try {
      // Generate embeddings
      const results = await generateEmbeddings(requests);

      // Write embeddings via raw SQL (Prisma can't handle vector type directly)
      for (const result of results) {
        const vectorStr = `[${result.embedding.join(",")}]`;
        await prisma.$executeRaw`
          UPDATE "CodexChunk"
          SET "embedding" = ${vectorStr}::vector
          WHERE "id" = ${result.id}
        `;
      }

      // Update tsvector search column
      const batchIds = batch.map((c) => c.id);
      await updateSearchVectors(batchIds);

      // Mark as EMBEDDED
      await markChunksEmbedded(batchIds, codexConfig.embedding.model);
      totalGenerated += results.length;
    } catch (error) {
      // Mark this batch as FAILED so they can be retried later
      const batchIds = batch.map((c) => c.id);
      await markChunksFailed(batchIds);
      totalFailed += batch.length;

      // Log but continue with remaining batches
      console.error(
        `Failed to embed batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    embeddingsGenerated: totalGenerated,
    embeddingsFailed: totalFailed,
  };
}
