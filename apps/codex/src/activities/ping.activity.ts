/**
 * Placeholder activity to verify Temporal connectivity.
 * Will be replaced by real clone/parse/embed activities in Phase 3.
 */
export async function ping(repositoryId: string): Promise<string> {
  console.log(`[codex] ping activity called for repository: ${repositoryId}`);
  return `pong:${repositoryId}`;
}
