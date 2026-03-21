import OpenAI from "openai";
import type { DraftReplyResult } from "@shared/types";

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a customer support AI agent drafting a reply to a customer.

# Task
Generate a reply draft based on the analysis of the customer's issue. The draft type determines your approach.

# Draft Types

## RESOLUTION — you have enough context to help
- Provide the answer, fix, or workaround directly
- If root cause analysis found a code issue, explain the cause in user-friendly terms
- If suggesting a workaround, clearly state it's temporary
- Include specific next steps the customer should take
- Do NOT say "I've investigated the codebase" — just provide the answer naturally

## CLARIFICATION — you need more information
- Ask specific, targeted questions about what's missing
- Maximum 3 questions per reply
- Be conversational, not robotic ("Could you tell me..." not "Please provide...")
- Briefly acknowledge what you DO understand before asking
- Do NOT repeat information the customer already provided

# Rules
- Never fabricate information not found in the investigation
- Never mention internal tools, code paths, or Sentry to the customer
- Keep replies concise — 2-4 paragraphs maximum
- Match the tone specified (default: friendly and professional)
- If a custom system prompt is provided, follow its guidance

# Output Format
Respond with ONLY valid JSON, no markdown fences:
{"body": "<the reply text>", "confidence": 0.0-1.0}`;

// ── Types ────────────────────────────────────────────────────────────

export interface DraftReplyInput {
  draftType: "RESOLUTION" | "CLARIFICATION";
  // For RESOLUTION: the analysis result
  analysisResult: {
    issueCategory: string | null;
    severity: string | null;
    affectedComponent: string | null;
    summary: string;
    rcaSummary: string | null;
  } | null;
  // For CLARIFICATION: what's missing
  missingContext: string[];
  // Thread context
  messages: Array<{
    direction: string;
    body: string;
  }>;
  customerDisplayName: string;
  // Agent config
  tone: string | null;
  customSystemPrompt: string | null;
}

export interface DraftReplyOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

// ── Build user message ───────────────────────────────────────────────

function buildUserMessage(input: DraftReplyInput): string {
  const recentMessages = input.messages.slice(-5);
  const messageList = recentMessages
    .map((m, i) => `${i + 1}. [${m.direction}] "${m.body}"`)
    .join("\n");

  const lines: string[] = [
    `Draft type: ${input.draftType}`,
    `Customer: ${input.customerDisplayName}`,
  ];

  if (input.tone) {
    lines.push(`Tone: ${input.tone}`);
  }

  lines.push("", "Recent messages:", messageList);

  if (input.draftType === "RESOLUTION" && input.analysisResult) {
    lines.push("");
    lines.push("Analysis:");
    if (input.analysisResult.issueCategory) lines.push(`  Category: ${input.analysisResult.issueCategory}`);
    if (input.analysisResult.affectedComponent) lines.push(`  Component: ${input.analysisResult.affectedComponent}`);
    lines.push(`  Summary: ${input.analysisResult.summary}`);
    if (input.analysisResult.rcaSummary) lines.push(`  Root cause: ${input.analysisResult.rcaSummary}`);
  }

  if (input.draftType === "CLARIFICATION" && input.missingContext.length > 0) {
    lines.push("");
    lines.push("Missing information:");
    input.missingContext.forEach((ctx) => lines.push(`  - ${ctx}`));
  }

  if (input.customSystemPrompt) {
    lines.push("");
    lines.push(`Additional guidance: ${input.customSystemPrompt}`);
  }

  lines.push("", "Write the reply draft.");

  return lines.join("\n");
}

// ── Export ────────────────────────────────────────────────────────────

export async function generateDraftReply(
  input: DraftReplyInput,
  options: DraftReplyOptions,
): Promise<DraftReplyResult | null> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 500,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(input) },
        ],
      },
      { signal: controller.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as DraftReplyResult;

    console.log(
      `[draft-reply] type=${input.draftType} confidence=${parsed.confidence} length=${parsed.body.length}`,
    );

    return parsed;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[draft-reply] timed out");
    } else {
      console.error("[draft-reply] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
