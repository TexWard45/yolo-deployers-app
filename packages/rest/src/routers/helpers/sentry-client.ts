// ── Sentry API Client ────────────────────────────────────────────────

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

// ── Sentry API helpers ──────────────────────────────────────────────

const SENTRY_BASE = "https://sentry.io/api/0";

interface SentryIssueResponse {
  id: string;
  title: string;
  culprit: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
  level: string;
}

interface SentryEventResponse {
  entries?: Array<{
    type: string;
    data?: {
      values?: Array<{
        stacktrace?: {
          frames?: Array<{
            filename?: string;
            function?: string;
            lineNo?: number;
            colNo?: number;
            context?: Array<[number, string]>;
          }>;
        };
      }>;
    };
  }>;
}

async function searchSentryIssues(
  config: SentryConfig,
  query: string,
  signal: AbortSignal,
): Promise<SentryIssueResponse[]> {
  const url = `${SENTRY_BASE}/projects/${config.orgSlug}/${config.projectSlug}/issues/?query=${encodeURIComponent(query)}&sort=date&limit=5`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.authToken}` },
    signal,
  });

  if (!response.ok) {
    console.warn(`[sentry] issues search failed (${response.status})`);
    return [];
  }

  return (await response.json()) as SentryIssueResponse[];
}

async function getLatestEvent(
  config: SentryConfig,
  issueId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const url = `${SENTRY_BASE}/issues/${issueId}/events/latest/`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${config.authToken}` },
    signal,
  });

  if (!response.ok) return null;

  const event = (await response.json()) as SentryEventResponse;

  // Extract stacktrace from exception entries
  const exceptionEntry = event.entries?.find((e) => e.type === "exception");
  if (!exceptionEntry?.data?.values) return null;

  const frames = exceptionEntry.data.values
    .flatMap((v) => v.stacktrace?.frames ?? [])
    .filter((f) => f.filename && !f.filename.startsWith("node_modules"))
    .slice(-5) // last 5 app frames
    .map((f) => `  at ${f.function ?? "<anonymous>"} (${f.filename}:${f.lineNo ?? "?"}:${f.colNo ?? "?"})`)
    .reverse()
    .join("\n");

  return frames || null;
}

/**
 * Fetch Sentry error context for thread messages.
 * Searches for matching issues and retrieves stack traces.
 */
export async function fetchSentryContext(
  config: SentryConfig,
  messageBodies: string[],
): Promise<SentryFinding[]> {
  const signals = extractErrorSignals(messageBodies);
  if (signals.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    // Search using the first 3 signals (most specific first)
    const searchQueries = signals.slice(0, 3);
    const allIssues: SentryIssueResponse[] = [];
    const seenIds = new Set<string>();

    for (const query of searchQueries) {
      const issues = await searchSentryIssues(config, query, controller.signal);
      for (const issue of issues) {
        if (!seenIds.has(issue.id)) {
          seenIds.add(issue.id);
          allIssues.push(issue);
        }
      }
    }

    // Limit to top 5 unique issues
    const topIssues = allIssues.slice(0, 5);

    // Fetch stack traces in parallel
    const findings: SentryFinding[] = await Promise.all(
      topIssues.map(async (issue) => {
        const stackTrace = await getLatestEvent(config, issue.id, controller.signal).catch(() => null);
        return {
          issueId: issue.id,
          title: issue.title,
          culprit: issue.culprit || null,
          count: parseInt(issue.count, 10) || 0,
          firstSeen: issue.firstSeen,
          lastSeen: issue.lastSeen,
          level: issue.level,
          stackTrace,
        };
      }),
    );

    return findings;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.warn("[sentry] request timed out (10s)");
    } else {
      console.error("[sentry] fetch failed:", error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
