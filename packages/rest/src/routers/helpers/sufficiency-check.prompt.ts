import OpenAI from "openai";
import type { SufficiencyCheckResult } from "@shared/types";

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support thread analyst for a customer support inbox.

# Task
Evaluate whether a support thread contains enough context to diagnose and resolve the customer's issue, or if more information is needed.

# Decision Framework

## SUFFICIENT — the thread has enough context when:
- The issue type is clear (bug, feature request, how-to question, account issue)
- For bugs: at least 2 of {error message, reproduction steps, affected feature/page, environment/browser}
- For feature requests: what they want AND why they want it
- For how-to questions: the question is clear enough to answer
- For account issues: account identifier + what went wrong

## INSUFFICIENT — more context is needed when:
- The message is vague ("it's broken", "not working", "need help")
- A bug report lacks reproduction steps AND error details
- It's unclear which feature or page is affected
- The customer references something ("the thing", "that page") without specifying what

# Rules
- Consider ALL messages in the thread, not just the latest
- Later messages may clarify earlier vague ones
- Customer frustration or urgency does NOT make context sufficient
- If the issue type is clear but details are thin, lean toward SUFFICIENT with lower confidence
- List exactly what's missing in the missingContext array — be specific ("error message or screenshot", "which page this happens on")

# Output Format
Respond with ONLY valid JSON, no markdown fences:
{"sufficient": true|false, "missingContext": ["<what is missing>"], "confidence": 0.0-1.0, "reasoning": "<one sentence>"}`;

// ── Types ────────────────────────────────────────────────────────────

export interface SufficiencyCheckInput {
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    createdAt: string;
  }>;
  customerDisplayName: string;
  issueFingerprint: string | null;
  threadSummary: string | null;
}

export interface SufficiencyCheckOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

// ── Build user message ───────────────────────────────────────────────

function buildUserMessage(input: SufficiencyCheckInput): string {
  const messageList = input.messages
    .map((m, i) => `${i + 1}. [${m.direction}] "${m.body}"`)
    .join("\n");

  const lines: string[] = [
    `Customer: ${input.customerDisplayName}`,
  ];

  if (input.threadSummary) {
    lines.push(`Thread summary: ${input.threadSummary}`);
  }
  if (input.issueFingerprint) {
    lines.push(`Keywords: ${input.issueFingerprint}`);
  }

  lines.push("", "Messages (oldest first):", messageList);
  lines.push("", "Is there enough context to diagnose and resolve this issue?");

  return lines.join("\n");
}

// ── Export ────────────────────────────────────────────────────────────

export async function checkSufficiency(
  input: SufficiencyCheckInput,
  options: SufficiencyCheckOptions,
): Promise<SufficiencyCheckResult | null> {
  if (input.messages.length === 0) {
    return { sufficient: false, missingContext: ["no messages in thread"], confidence: 1, reasoning: "Empty thread" };
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 300,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(input) },
        ],
      },
      { signal: controller.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as SufficiencyCheckResult;

    console.log(
      `[sufficiency-check] sufficient=${parsed.sufficient} confidence=${parsed.confidence} missing=${parsed.missingContext.length}`,
    );

    return parsed;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[sufficiency-check] timed out");
    } else {
      console.error("[sufficiency-check] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
