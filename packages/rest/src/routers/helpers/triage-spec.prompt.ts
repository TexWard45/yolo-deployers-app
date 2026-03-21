import OpenAI from "openai";

// ── System Prompt — Linear Issue Body ───────────────────────────────

const TRIAGE_SYSTEM_PROMPT = `You are a support engineer triaging a customer issue into a Linear ticket. You have the full AI analysis, codebase search results, and error tracking data.

# Task
Generate a structured Linear issue body from the analysis. The output will be pasted directly as the Linear issue description (markdown).

# Structure
Use this exact markdown structure:

## Summary
1-3 sentence engineering summary of the issue.

## Customer Impact
- Severity: {severity}
- Category: {issueCategory}
- Affected Component: {affectedComponent}

## Reproduction / Symptoms
Bullet list of what the customer reported (from messages).

## Root Cause Analysis
{rcaSummary} — expand with evidence from code and error data.

## Related Code
List file paths and functions from codebase search (if available).

## Error Tracking
List Sentry errors with titles, occurrence counts, and stack trace snippets (if available).

## Suggested Fix
Brief description of what needs to change to resolve the issue.

# Rules
- Be specific: name files, functions, error types
- If data is missing, omit that section entirely rather than writing "N/A"
- Keep total length under 2000 characters
- Do NOT include JSON or code fences in the output — just markdown

# Output
Respond with ONLY the markdown body, no wrapping.`;

// ── System Prompt — Eng Spec ────────────────────────────────────────

const SPEC_SYSTEM_PROMPT = `You are a senior software engineer writing an engineering spec for a bug fix or feature based on a support analysis.

# Task
Generate a concise engineering specification in markdown.

# Structure

## Job to Be Done
1-2 sentences: what needs fixing/building and why.

## Proposed Fix
Describe the technical approach. Reference specific files and functions from the codebase search results. Be concrete.

## Task Checklist
\`\`\`
- [ ] Task 1 — what file/function to change
- [ ] Task 2 — ...
\`\`\`

## Testing Checklist
\`\`\`
- [ ] Happy path — ...
- [ ] Edge case — ...
- [ ] Regression — ...
\`\`\`

# Rules
- Reference actual file paths and function names from the analysis
- Keep it actionable — each task should be one commit
- Total length under 2000 characters
- Respond with ONLY the markdown, no wrapping`;

// ── Types ───────────────────────────────────────────────────────────

export interface TriagePromptInput {
  analysis: {
    issueCategory: string | null;
    severity: string | null;
    affectedComponent: string | null;
    summary: string;
    rcaSummary: string | null;
    codexFindings: unknown | null;
    sentryFindings: unknown | null;
  };
  messages: Array<{ direction: string; body: string }>;
  customerDisplayName: string;
  threadTitle: string | null;
  telemetryFindings?: {
    sessionId?: string;
    sessionUrl?: string;
    errorCount?: number;
    errors?: Array<{ message?: string; timestamp?: string }>;
    userAgent?: string | null;
  } | null;
}

export interface TriagePromptOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

// ── Build user messages ─────────────────────────────────────────────

function buildTriageUserMessage(input: TriagePromptInput): string {
  const lines: string[] = [
    `Customer: ${input.customerDisplayName}`,
    `Thread: ${input.threadTitle ?? "Untitled"}`,
    "",
    `Issue Category: ${input.analysis.issueCategory ?? "unknown"}`,
    `Severity: ${input.analysis.severity ?? "unknown"}`,
    `Affected Component: ${input.analysis.affectedComponent ?? "unknown"}`,
    "",
    `Summary: ${input.analysis.summary}`,
  ];

  if (input.analysis.rcaSummary) {
    lines.push(`RCA: ${input.analysis.rcaSummary}`);
  }

  // Recent messages
  const recentMessages = input.messages.slice(-5);
  lines.push("", "Recent messages:");
  for (const m of recentMessages) {
    lines.push(`  [${m.direction}] ${m.body.slice(0, 200)}`);
  }

  // Codex findings
  if (input.analysis.codexFindings) {
    const codex = input.analysis.codexFindings as {
      chunks?: Array<{ filePath?: string; symbolName?: string; content?: string }>;
    };
    if (codex.chunks && codex.chunks.length > 0) {
      lines.push("", "Codebase search results:");
      for (const c of codex.chunks.slice(0, 5)) {
        lines.push(`  - ${c.filePath ?? "unknown"}${c.symbolName ? ` (${c.symbolName})` : ""}`);
        if (c.content) {
          lines.push(`    ${c.content.slice(0, 200)}`);
        }
      }
    }
  }

  // Sentry findings
  if (input.analysis.sentryFindings && Array.isArray(input.analysis.sentryFindings)) {
    const sentry = input.analysis.sentryFindings as Array<{
      title?: string;
      culprit?: string | null;
      count?: number;
      firstSeen?: string;
      lastSeen?: string;
      level?: string;
      stackTrace?: string | null;
    }>;
    if (sentry.length > 0) {
      lines.push("", "Sentry errors:");
      for (const e of sentry.slice(0, 5)) {
        lines.push(`  - ${e.title ?? "unknown"} (${e.count ?? 0}x, level: ${e.level ?? "unknown"})`);
        if (e.culprit) {
          lines.push(`    Culprit: ${e.culprit}`);
        }
        if (e.stackTrace) {
          lines.push(`    Stack: ${e.stackTrace.slice(0, 200)}`);
        }
      }
    }
  }

  if (input.telemetryFindings) {
    lines.push("", "Session replay / telemetry:");
    if (input.telemetryFindings.sessionUrl) {
      lines.push(`  - Replay URL: ${input.telemetryFindings.sessionUrl}`);
    }
    if (typeof input.telemetryFindings.errorCount === "number") {
      lines.push(`  - Error count: ${input.telemetryFindings.errorCount}`);
    }
    if (input.telemetryFindings.userAgent) {
      lines.push(`  - User agent: ${input.telemetryFindings.userAgent}`);
    }
    const errors = input.telemetryFindings.errors ?? [];
    for (const error of errors.slice(0, 5)) {
      if (error.message) {
        lines.push(`  - ${error.message.slice(0, 220)}`);
      }
    }
  }

  return lines.join("\n");
}

// ── Exports ─────────────────────────────────────────────────────────

export async function generateLinearIssueBody(
  input: TriagePromptInput,
  options: TriagePromptOptions,
): Promise<{ title: string; description: string } | null> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    // Generate title
    const title = input.analysis.affectedComponent
      ? `[${input.analysis.severity?.toUpperCase() ?? "BUG"}] ${input.analysis.summary.slice(0, 80)}`
      : input.analysis.summary.slice(0, 100);

    // Generate description
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 800,
        temperature: 0,
        messages: [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT },
          { role: "user", content: buildTriageUserMessage(input) },
        ],
      },
      { signal: controller.signal },
    );

    const description = response.choices[0]?.message?.content ?? "";

    console.log(`[triage-spec] generated Linear issue body (${description.length} chars)`);

    return { title, description };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[triage-spec] timed out");
    } else {
      console.error("[triage-spec] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateEngSpec(
  input: TriagePromptInput,
  options: TriagePromptOptions,
): Promise<{ specMarkdown: string; specTitle: string } | null> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-4.1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 1000,
        temperature: 0,
        messages: [
          { role: "system", content: SPEC_SYSTEM_PROMPT },
          { role: "user", content: buildTriageUserMessage(input) },
        ],
      },
      { signal: controller.signal },
    );

    const specMarkdown = response.choices[0]?.message?.content ?? "";
    const specTitle = `Spec: ${input.analysis.summary.slice(0, 80)}`;

    console.log(`[triage-spec] generated eng spec (${specMarkdown.length} chars)`);

    return { specMarkdown, specTitle };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[triage-spec] spec generation timed out");
    } else {
      console.error("[triage-spec] spec generation failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
