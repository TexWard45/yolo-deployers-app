// ── Sentry API Client (MVP stub — returns empty results) ────────────

export interface SentryConfig {
  orgSlug: string;
  projectSlug: string;
  authToken: string;
}

export interface SentryFinding {
  issueId: string;
  title: string;
  culprit: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  level: string;
  stackTrace: string | null;
}

/**
 * Extract error signals from message bodies.
 * Looks for: error messages, Sentry URLs, stack traces, HTTP status codes.
 */
export function extractErrorSignals(messageBodies: string[]): string[] {
  const signals: Set<string> = new Set();

  for (const body of messageBodies) {
    // Sentry issue URLs — extract issue ID
    const sentryUrlMatch = body.match(/sentry\.io\/issues\/(\d+)/g);
    if (sentryUrlMatch) {
      for (const match of sentryUrlMatch) signals.add(match);
    }

    // Error-like patterns: "Error:", "TypeError:", "Exception", etc.
    const errorMatch = body.match(/\b(\w*Error|Exception|FATAL|CRITICAL):\s*[^\n]{5,80}/gi);
    if (errorMatch) {
      for (const match of errorMatch) signals.add(match.trim());
    }

    // HTTP status codes: "500", "404", "502" etc.
    const httpMatch = body.match(/\b(4\d{2}|5\d{2})\b/g);
    if (httpMatch) {
      for (const match of httpMatch) signals.add(`HTTP ${match}`);
    }

    // Stack trace fragments: "at <function> (<file>:<line>)"
    const stackMatch = body.match(/at\s+\w+.*\(.*:\d+:\d+\)/g);
    if (stackMatch) {
      for (const match of stackMatch) signals.add(match.trim());
    }
  }

  return [...signals];
}

/**
 * Fetch Sentry error context for thread messages.
 * MVP: returns empty array. Phase 2 will call the Sentry Web API.
 */
export async function fetchSentryContext(
  _config: SentryConfig,
  _messageBodies: string[],
): Promise<SentryFinding[]> {
  // TODO: Phase 2 — implement Sentry Web API integration
  // 1. Extract error signals from messages
  // 2. Search issues: GET /api/0/projects/{org}/{project}/issues/?query=...
  // 3. Get latest event: GET /api/0/issues/{issueId}/events/latest/
  // 4. Format into SentryFinding[]
  return [];
}
