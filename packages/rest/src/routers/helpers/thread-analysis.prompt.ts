import OpenAI from "openai";
import type { ThreadAnalysisResult } from "@shared/types";

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a support engineer analyzing a customer issue. You have access to the conversation, codebase search results, and error tracking data.

# Task
Produce a structured analysis of the customer's issue: classify it, assess severity, identify the affected component, write a concise summary, and provide root cause analysis when possible.

# Classification
- issueCategory: "bug" | "feature_request" | "how_to" | "account" | "outage" | "performance" | "integration" | "other"
- severity:
  - "critical" — data loss, security vulnerability, total service outage, payment failures
  - "high" — core feature broken, many users affected, no workaround
  - "medium" — feature degraded but usable, workaround exists, limited impact
  - "low" — cosmetic issue, edge case, minor inconvenience

# Root Cause Analysis
- If codebase search results are provided, connect the customer's symptoms to the relevant code paths
- If error tracking data is provided, cite error types, frequency, and stack trace context
- If neither is available, provide your best assessment based on the conversation alone
- Be specific: name files, functions, error types when the data supports it
- If you cannot determine root cause, say so — do NOT fabricate

# Rules
- summary should be 1-3 sentences describing the issue from an engineering perspective
- rcaSummary should explain the likely root cause and cite evidence (code findings, error data, or conversation clues)
- affectedComponent should be the feature, page, or system area (e.g., "authentication", "billing page", "API rate limiter")
- If data is insufficient for any field, set it to null rather than guessing

# Output Format
Respond with ONLY valid JSON, no markdown fences:
{"issueCategory": "...", "severity": "...", "affectedComponent": "...", "summary": "...", "rcaSummary": "...", "confidence": 0.0-1.0}`;

// ── Types ────────────────────────────────────────────────────────────

export interface ThreadAnalysisInput {
  messages: Array<{
    id: string;
    direction: string;
    body: string;
    createdAt: string;
  }>;
  customerDisplayName: string;
  issueFingerprint: string | null;
  threadSummary: string | null;
  codexFindings: unknown | null;
  sentryFindings: unknown | null;
  expandedContext?: unknown | null;
}

export interface ThreadAnalysisOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

// ── Build user message ───────────────────────────────────────────────

function buildUserMessage(input: ThreadAnalysisInput): string {
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

  if (input.codexFindings) {
    const codex = input.codexFindings as { chunks?: Array<{ filePath?: string; symbolName?: string; content?: string; score?: number }> };
    if (codex.chunks && codex.chunks.length > 0) {
      const codexList = codex.chunks
        .slice(0, 5)
        .map((c, i) => {
          const parts = [`${i + 1}. ${c.filePath ?? "unknown"}${c.symbolName ? ` (${c.symbolName})` : ""}`];
          if (c.content) {
            const truncated = c.content.length > 300 ? c.content.slice(0, 300) + "..." : c.content;
            parts.push(`   ${truncated}`);
          }
          return parts.join("\n");
        })
        .join("\n");
      lines.push("", "Primary evidence (codebase search):", codexList);
    }
  }

  // Expanded context: parent classes + sibling methods
  if (input.expandedContext) {
    const expanded = input.expandedContext as Record<string, {
      parent?: { symbolName?: string; chunkType?: string; content?: string; file?: { filePath?: string } } | null;
      siblings?: Array<{ symbolName?: string; chunkType?: string; content?: string; file?: { filePath?: string } }>;
    }>;

    const contextEntries: string[] = [];
    for (const [chunkId, ctx] of Object.entries(expanded)) {
      if (!ctx.parent && (!ctx.siblings || ctx.siblings.length === 0)) continue;

      const parts: string[] = [];
      if (ctx.parent) {
        parts.push(`  Parent: ${ctx.parent.file?.filePath ?? "unknown"} — ${ctx.parent.chunkType ?? "unknown"} ${ctx.parent.symbolName ?? ""}`);
        if (ctx.parent.content) {
          const truncated = ctx.parent.content.length > 200 ? ctx.parent.content.slice(0, 200) + "..." : ctx.parent.content;
          parts.push(`    ${truncated}`);
        }
      }
      if (ctx.siblings && ctx.siblings.length > 0) {
        parts.push(`  Siblings (${ctx.siblings.length}):`);
        for (const sib of ctx.siblings.slice(0, 3)) {
          parts.push(`    - ${sib.chunkType ?? "unknown"} ${sib.symbolName ?? "(anonymous)"} in ${sib.file?.filePath ?? "unknown"}`);
        }
      }
      if (parts.length > 0) {
        contextEntries.push(`  Chunk ${chunkId}:\n${parts.join("\n")}`);
      }
    }

    if (contextEntries.length > 0) {
      lines.push("", "Surrounding context (parent classes + sibling methods):", contextEntries.join("\n"));
    }
  }

  if (input.sentryFindings && Array.isArray(input.sentryFindings) && (input.sentryFindings as unknown[]).length > 0) {
    const sentryList = (input.sentryFindings as Array<{ title?: string; culprit?: string | null; count?: number; firstSeen?: string; lastSeen?: string; level?: string; stackTrace?: string | null }>)
      .slice(0, 5)
      .map((e, i) => {
        const parts = [`${i + 1}. ${e.title ?? "unknown"} (${e.count ?? 0} occurrences, level: ${e.level ?? "unknown"}, last seen: ${e.lastSeen ?? "unknown"})`];
        if (e.culprit) {
          parts.push(`   Culprit: ${e.culprit}`);
        }
        if (e.stackTrace) {
          const truncated = e.stackTrace.length > 200 ? e.stackTrace.slice(0, 200) + "..." : e.stackTrace;
          parts.push(`   Stack: ${truncated}`);
        }
        return parts.join("\n");
      })
      .join("\n");
    lines.push("", "Error tracking data:", sentryList);
  }

  lines.push("", "Analyze this issue and provide a structured assessment.");

  return lines.join("\n");
}

// ── Export ────────────────────────────────────────────────────────────

export async function analyzeThread(
  input: ThreadAnalysisInput,
  options: ThreadAnalysisOptions,
): Promise<ThreadAnalysisResult | null> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25000);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 500,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(input) },
        ],
      },
      { signal: controller.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as ThreadAnalysisResult;

    console.log(
      `[thread-analysis] category=${parsed.issueCategory} severity=${parsed.severity} confidence=${parsed.confidence}`,
    );

    return parsed;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[thread-analysis] timed out");
    } else {
      console.error("[thread-analysis] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
