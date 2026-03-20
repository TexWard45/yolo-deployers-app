import { prisma } from "@shared/database";

export interface PendingChunk {
  id: string;
  chunkType: string;
  symbolName: string | null;
  parameters: string[];
  returnType: string | null;
  imports: string[];
  exportType: string | null;
  isAsync: boolean;
  docstring: string | null;
  content: string;
  file: {
    filePath: string;
    language: string;
  };
}

/**
 * Find all PENDING chunks for a repository that need embedding.
 */
export async function findPendingChunks(
  repositoryId: string,
): Promise<PendingChunk[]> {
  const chunks = await prisma.codexChunk.findMany({
    where: {
      embeddingStatus: "PENDING",
      file: { repositoryId },
    },
    select: {
      id: true,
      chunkType: true,
      symbolName: true,
      parameters: true,
      returnType: true,
      imports: true,
      exportType: true,
      isAsync: true,
      docstring: true,
      content: true,
      file: {
        select: {
          filePath: true,
          language: true,
        },
      },
    },
  });

  return chunks;
}

/**
 * Mark chunks as EMBEDDED after successful embedding write.
 */
export async function markChunksEmbedded(
  chunkIds: string[],
  modelId: string,
): Promise<void> {
  if (chunkIds.length === 0) return;

  await prisma.codexChunk.updateMany({
    where: { id: { in: chunkIds } },
    data: {
      embeddingStatus: "EMBEDDED",
      embeddingModelId: modelId,
      embeddedAt: new Date(),
    },
  });
}

/**
 * Mark chunks as FAILED after embedding failure.
 */
export async function markChunksFailed(
  chunkIds: string[],
): Promise<void> {
  if (chunkIds.length === 0) return;

  await prisma.codexChunk.updateMany({
    where: { id: { in: chunkIds } },
    data: {
      embeddingStatus: "FAILED",
    },
  });
}
