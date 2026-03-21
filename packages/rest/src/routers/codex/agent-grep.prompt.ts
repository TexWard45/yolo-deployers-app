import type OpenAI from "openai";
import type { AgentGrepSummarizeResult } from "@shared/types";

// ── System Prompt ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a code search query planner. Given a task description, generate targeted search parameters to find the most relevant code in a repository.

# Task
Analyze the task description and produce structured search parameters that will be used to query a codebase index (vector embeddings, full-text search, and symbol lookup).

# Output Fields

1. **summary** — A one-sentence summary of the task.
2. **semanticQueries** — 1-5 natural language queries for vector similarity search. Each should capture a different aspect of the task. Be specific and descriptive.
3. **keywords** — Up to 10 keywords for full-text search. Include function names, error messages, config keys, API paths, or domain terms mentioned in the task.
4. **symbolNames** — Up to 10 function, class, type, or interface names that are likely relevant. Use exact casing if mentioned in the task.
5. **languages** — Programming languages likely relevant (e.g. "typescript", "python"). Omit if unclear.
6. **chunkTypes** — Relevant code structure types from: FUNCTION, METHOD, CLASS, TYPE, INTERFACE, ENUM, ROUTE_HANDLER, MODULE, FRAGMENT. Omit if the task doesn't suggest specific types.

# Strategy

- For bug fixes: focus on error messages, the affected feature area, and related function names
- For new features: focus on existing similar features, relevant domain models, and integration points
- For refactoring: focus on the code to be changed and its dependents
- For understanding: cast a wider net with varied semantic queries

# Examples

Task: "fix the login timeout bug where users get logged out after 5 minutes"
{
  "summary": "Fix premature session timeout causing users to be logged out after 5 minutes",
  "semanticQueries": ["session timeout configuration and token expiry", "login authentication middleware that manages user sessions", "token refresh logic and session renewal"],
  "keywords": ["timeout", "session", "login", "expire", "token", "refresh", "auth"],
  "symbolNames": ["handleLogin", "refreshToken", "sessionMiddleware", "AuthConfig"],
  "languages": ["typescript"],
  "chunkTypes": ["FUNCTION", "METHOD"]
}

Task: "add a dark mode toggle to the settings page"
{
  "summary": "Add dark mode toggle to the settings page UI",
  "semanticQueries": ["settings page component with user preferences", "theme configuration and dark mode styles", "toggle switch component for boolean settings"],
  "keywords": ["settings", "theme", "dark", "mode", "toggle", "preferences"],
  "symbolNames": ["SettingsPage", "ThemeProvider", "useTheme"],
  "languages": ["typescript"],
  "chunkTypes": ["FUNCTION", "CLASS"]
}

# Output Format
Respond with ONLY valid JSON, no markdown fences.`;

// ── Build user message ───────────────────────────────────────────────

function buildUserMessage(taskDescription: string): string {
  return `Task: "${taskDescription}"`;
}

// ── Export ───────────────────────────────────────────────────────────

export async function llmSummarizeTask(
  taskDescription: string,
  openaiClient: OpenAI,
): Promise<AgentGrepSummarizeResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await openaiClient.chat.completions.create(
      {
        model: "gpt-4.1",
        max_tokens: 500,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(taskDescription) },
        ],
      },
      { signal: controller.signal },
    );

    const text = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(text) as AgentGrepSummarizeResult;

    console.log(
      `[agent-grep-prompt] summary="${parsed.summary}" queries=${parsed.semanticQueries.length} keywords=${parsed.keywords.length} symbols=${parsed.symbolNames.length}`,
    );

    return {
      summary: parsed.summary,
      semanticQueries: parsed.semanticQueries.slice(0, 5),
      keywords: parsed.keywords.slice(0, 10),
      symbolNames: parsed.symbolNames.slice(0, 10),
      languages: parsed.languages,
      chunkTypes: parsed.chunkTypes,
    };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[agent-grep-prompt] timed out");
    } else {
      console.error("[agent-grep-prompt] failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
