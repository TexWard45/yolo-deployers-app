import OpenAI from "openai";
import type { ThreadReviewResult } from "@shared/types";

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support thread reviewer for a customer support inbox.

# Task
Review a batch of recent messages on a support thread and decide if they ALL belong to the same issue, or if some messages should be EJECTED to a different thread.

# Decision Framework
1. KEEP ALL — when:
   - All messages discuss the same issue, feature, bug, or topic
   - Messages are follow-ups, complaints, or updates about the same thing
   - Vague messages ("i need to fix this", "any update?") in the context of surrounding messages clearly relate to the same topic
   - Only 1 message in the thread — nothing to eject

2. EJECT — when:
   - A message is clearly about a DIFFERENT product area or topic
   - A message introduces a completely new issue unrelated to the rest
   - Example: 3 messages about "settings page bugs" + 1 message about "billing invoice" → eject the billing message

# Rules
- Read ALL messages in order to understand the conversation flow
- Vague messages get meaning from context — "still broken" after "login page crashes" means login, not a new issue
- When ejecting, check if any candidate thread matches the ejected message's topic. If yes, set targetThreadId. If no match, set targetThreadId to null (a new thread will be created).
- NEVER eject all messages — at least one must stay on the original thread
- Prefer keeping messages together over splitting — only eject when the topic difference is clear

# Examples

Messages: ["settings page is broken", "need fix asap", "who wrote this trash code on settings", "i need to fix this"]
→ {"verdict": "keep_all", "ejections": []}
Reason: All about settings page code quality — vague follow-ups are clearly in the same context.

Messages: ["login keeps timing out", "still happening", "also my invoice shows wrong amount"]
Candidates: [Thread "billing-123": "billing invoice discrepancy"]
→ {"verdict": "eject", "ejections": [{"messageId": "msg-3", "reason": "billing issue unrelated to login timeout", "targetThreadId": "billing-123"}]}

Messages: ["can you help me", "need support"]
→ {"verdict": "keep_all", "ejections": []}
Reason: Too vague to split — keep together.

# Output Format
Respond with ONLY valid JSON, no markdown fences:
{"verdict": "keep_all" | "eject", "ejections": [{"messageId": "<id>", "reason": "<one sentence>", "targetThreadId": "<thread-id or null>"}]}`;

// ── Types ────────────────────────────────────────────────────────────

export interface ThreadReviewInput {
  threadId: string;
  threadSummary: string | null;
  messages: Array<{
    id: string;
    body: string;
    createdAt: string;
  }>;
  candidateThreads: Array<{
    id: string;
    summary: string | null;
    issueFingerprint: string | null;
  }>;
}

export interface ThreadReviewOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

// ── Build user message ───────────────────────────────────────────────

function buildUserMessage(input: ThreadReviewInput): string {
  const messageList = input.messages
    .map((m, i) => `${i + 1}. [${m.id}] "${m.body}"`)
    .join("\n");

  const lines: string[] = [
    `Thread: ${input.threadId}`,
  ];

  if (input.threadSummary) {
    lines.push(`Summary: ${input.threadSummary}`);
  }

  lines.push("", "Messages (oldest first):", messageList);

  if (input.candidateThreads.length > 0) {
    const candidateList = input.candidateThreads
      .map((c) => {
        const parts = [`- ID: ${c.id}`];
        if (c.summary) parts.push(`  Summary: ${c.summary}`);
        if (c.issueFingerprint) parts.push(`  Keywords: ${c.issueFingerprint}`);
        return parts.join("\n");
      })
      .join("\n");

    lines.push("", "Other open threads (possible ejection targets):", candidateList);
  }

  lines.push("", "Do all messages belong together, or should any be ejected?");

  return lines.join("\n");
}

// ── Export ────────────────────────────────────────────────────────────

export async function reviewThreadMessages(
  input: ThreadReviewInput,
  options: ThreadReviewOptions,
): Promise<ThreadReviewResult | null> {
  // Nothing to review with 0 or 1 messages
  if (input.messages.length <= 1) {
    return { verdict: "keep_all", ejections: [] };
  }

  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

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
    const parsed = JSON.parse(text) as ThreadReviewResult;

    console.log(
      `[thread-review-prompt] verdict=${parsed.verdict} ejections=${parsed.ejections.length}`,
    );

    return parsed;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[thread-review-prompt] timed out");
    } else {
      console.error("[thread-review-prompt] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
