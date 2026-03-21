import type { LlmThreadMatchInput, LlmThreadMatchResult } from "@shared/types";
import { queueEnv } from "@shared/env/queue";
import { llmThreadMatch } from "@shared/rest";

export async function llmThreadMatchActivity(
  input: LlmThreadMatchInput,
): Promise<LlmThreadMatchResult | null> {
  const apiKey = queueEnv.LLM_API_KEY;
  if (!apiKey) {
    console.warn("[llm-thread-match] LLM_API_KEY not set, skipping LLM matching");
    return null;
  }

  return llmThreadMatch(input, {
    apiKey,
    model: "gpt-4.1",
    timeoutMs: 25000, // longer timeout for async workflow
  });
}
