import type { LlmThreadMatchInput, LlmThreadMatchResult } from "@shared/types";

/**
 * Temporal activity placeholder for low-confidence thread matching.
 * This uses a lightweight heuristic until provider wiring is enabled.
 */
export async function llmThreadMatchActivity(
  input: LlmThreadMatchInput,
): Promise<LlmThreadMatchResult | null> {
  const normalize = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);

  const score = (a: string, b: string): number => {
    const setA = new Set(normalize(a));
    const setB = new Set(normalize(b));
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  };

  let bestThreadId: string | null = null;
  let bestScore = 0;

  for (const candidate of input.candidates) {
    const basis = candidate.issueFingerprint ?? candidate.summary ?? "";
    const currentScore = score(input.incomingMessage, basis);
    if (currentScore > bestScore) {
      bestScore = currentScore;
      bestThreadId = candidate.id;
    }
  }

  if (!bestThreadId || bestScore <= 0) {
    return {
      matchedThreadId: null,
      confidence: 0,
      reason: "no_heuristic_match",
    };
  }

  return {
    matchedThreadId: bestThreadId,
    confidence: Number(bestScore.toFixed(3)),
    reason: "heuristic_fallback_match",
  };
}
