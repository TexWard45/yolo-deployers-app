import OpenAI from "openai";
import type { LlmThreadMatchInput, LlmThreadMatchResult } from "@shared/types";

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support thread classifier for a customer support inbox.

# Task
Decide whether an incoming message belongs to an existing open support thread or is a NEW, unrelated issue.

# Decision Framework
1. SAME ISSUE — match when:
   - Message discusses the same feature, bug, or topic as a candidate thread
   - Message is a follow-up, even with completely different wording ("this is broken" → thread about "settings page crash")
   - Message references the same area of the product (e.g. "settings", "billing", "login")
   - Vague follow-ups ("i need to fix this", "any update?", "still broken") — match to the thread that is most contextually relevant given the grouping hint

2. NEW ISSUE — return null when:
   - Message is about a clearly different product area or topic than ALL candidates
   - No candidate thread relates to the message even loosely
   - Message explicitly starts a new topic ("separate issue:", "unrelated but", "new question")

# Confidence Scoring
- 0.95+  Obvious match — same keywords, same topic, direct reference
- 0.85-0.94  Strong match — different wording but clearly same issue/area
- 0.70-0.84  Likely match — related topic, some ambiguity
- 0.50-0.69  Weak — could go either way
- <0.50  Probably new issue — return null

# Examples

Message: "i need to fix this"
Hint: "need fix"
Thread: "who the f write this trash code on setting page | settings page code quality"
→ {"matchedThreadId": "abc", "confidence": 0.88, "reason": "follow-up to settings page code quality complaint"}

Message: "billing is showing wrong amount"
Thread: "settings page crash on save"
→ {"matchedThreadId": null, "confidence": 0.15, "reason": "billing issue is unrelated to settings page crash"}

Message: "still happening"
Hint: "still happening"
Thread 1: "login timeout errors | users can't log in"
Thread 2: "dark mode toggle broken"
→ {"matchedThreadId": "<thread1-id>", "confidence": 0.82, "reason": "vague follow-up, login timeout is more likely to be an ongoing issue than UI toggle"}

# Output Format
Respond with ONLY valid JSON, no markdown fences:
{"matchedThreadId": "<thread-id or null>", "confidence": <number 0-1>, "reason": "<one sentence>"}`;

// ── Build user message ───────────────────────────────────────────────

function buildUserMessage(input: LlmThreadMatchInput): string {
  const candidateList = input.candidates
    .map((c, i) => {
      const parts = [`${i + 1}. ID: ${c.id}`];
      if (c.summary) parts.push(`   Summary: ${c.summary}`);
      if (c.issueFingerprint) parts.push(`   Keywords: ${c.issueFingerprint}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const lines: string[] = [
    `Message: "${input.incomingMessage}"`,
  ];

  if (input.threadGroupingHint) {
    lines.push(`Hint: "${input.threadGroupingHint}"`);
  }

  lines.push("", "Open threads:", "", candidateList);

  return lines.join("\n");
}

// ── Exports ──────────────────────────────────────────────────────────

export interface LlmThreadMatchOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

export async function llmThreadMatch(
  input: LlmThreadMatchInput,
  options: LlmThreadMatchOptions,
): Promise<LlmThreadMatchResult | null> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 150,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(input) },
        ],
      },
      { signal: controller.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as {
      matchedThreadId: string | null;
      confidence: number;
      reason: string;
    };

    console.log(
      `[thread-match-prompt] threadId=${parsed.matchedThreadId} confidence=${parsed.confidence} reason="${parsed.reason}"`,
    );

    return {
      matchedThreadId: parsed.matchedThreadId,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      reason: parsed.reason,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[thread-match-prompt] timed out");
    } else {
      console.error("[thread-match-prompt] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
