import { prisma } from "@shared/database";

/**
 * Update the tsvector searchVector column for chunks using raw SQL.
 * Combines symbolName, docstring, and content into a weighted tsvector.
 *
 * Weight A: symbolName (highest relevance)
 * Weight B: docstring
 * Weight C: content (code body)
 */
export async function updateSearchVectors(
  chunkIds: string[],
): Promise<void> {
  if (chunkIds.length === 0) return;

  // Process in batches to avoid overly large SQL statements
  const BATCH_SIZE = 500;
  for (let i = 0; i < chunkIds.length; i += BATCH_SIZE) {
    const batch = chunkIds.slice(i, i + BATCH_SIZE);
    await prisma.$executeRaw`
      UPDATE "CodexChunk"
      SET "searchVector" =
        setweight(to_tsvector('english', COALESCE("symbolName", '')), 'A') ||
        setweight(to_tsvector('english', COALESCE("docstring", '')), 'B') ||
        setweight(to_tsvector('english', COALESCE("content", '')), 'C')
      WHERE id = ANY(${batch}::text[])
    `;
  }
}
