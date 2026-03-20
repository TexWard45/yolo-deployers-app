import type { LlmThreadMatchInput, LlmThreadMatchResult } from "@shared/types";

/**
 * Temporal activity placeholder for low-confidence thread matching.
 * This intentionally returns `null` until provider wiring is enabled.
 */
export async function llmThreadMatchActivity(
  _input: LlmThreadMatchInput,
): Promise<LlmThreadMatchResult | null> {
  return null;
}
