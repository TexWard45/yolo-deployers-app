export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export type MatchStrategy =
  | "external_thread_id"
  | "reply_chain"
  | "time_proximity"
  | "fingerprint"
  | "llm_inline"
  | "llm_fallback"
  | "new_thread";

export interface ThreadMatchCandidate {
  id: string;
  customerId: string;
  externalThreadId: string;
  issueFingerprint: string | null;
  summary: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
}

export interface DeterministicMatchInput {
  externalThreadId?: string | null;
  inReplyToExternalMessageId?: string | null;
  threadGroupingHint?: string | null;
  messageBody: string;
  customerId: string;
  recencyWindowMs: number;
  existingThreadByExternalId: ThreadMatchCandidate | null;
  threadIdByReplyChain: string | null;
  candidates: ThreadMatchCandidate[];
}

export interface MatchDecision {
  threadId: string | null;
  confidence: number;
  strategy: MatchStrategy;
  issueFingerprint: string;
  requiresReview: boolean;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "have",
  "hello",
  "hey",
  "hi",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
  "your",
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function normalizeText(input: string): string {
  return tokenize(input).join(" ");
}

export function buildIssueFingerprint(input: string): string {
  const tokens = tokenize(input);
  const uniqueOrdered: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (!seen.has(token)) {
      uniqueOrdered.push(token);
      seen.add(token);
    }
    if (uniqueOrdered.length >= 12) break;
  }

  return uniqueOrdered.join(" ");
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function buildThreadSummary(previousSummary: string | null, incomingMessage: string): string {
  const cleanIncoming = incomingMessage.trim().replace(/\s+/g, " ");
  const boundedIncoming = cleanIncoming.slice(0, 180);

  if (!previousSummary || previousSummary.trim().length === 0) {
    return boundedIncoming;
  }

  const merged = `${previousSummary.trim()} | ${boundedIncoming}`;
  return merged.length > 220 ? merged.slice(0, 220) : merged;
}

export function decideDeterministicThreadMatch(input: DeterministicMatchInput): MatchDecision {
  const issueFingerprint = buildIssueFingerprint(
    `${input.threadGroupingHint ?? ""} ${input.messageBody}`,
  );

  if (input.externalThreadId && input.existingThreadByExternalId) {
    return {
      threadId: input.existingThreadByExternalId.id,
      confidence: 0.99,
      strategy: "external_thread_id",
      issueFingerprint,
      requiresReview: false,
    };
  }

  if (input.inReplyToExternalMessageId && input.threadIdByReplyChain) {
    return {
      threadId: input.threadIdByReplyChain,
      confidence: 0.96,
      strategy: "reply_chain",
      issueFingerprint,
      requiresReview: false,
    };
  }

  // Time-proximity: same customer, recent activity, no explicit new thread boundary
  if (input.recencyWindowMs > 0 && !input.externalThreadId) {
    const now = Date.now();
    let recentCandidate: ThreadMatchCandidate | null = null;
    let recentTime = 0;

    for (const candidate of input.candidates) {
      if (candidate.customerId !== input.customerId) continue;
      const inboundTs = candidate.lastInboundAt?.getTime() ?? 0;
      if (inboundTs > 0 && now - inboundTs <= input.recencyWindowMs && inboundTs > recentTime) {
        recentCandidate = candidate;
        recentTime = inboundTs;
      }
    }

    if (recentCandidate) {
      return {
        threadId: recentCandidate.id,
        confidence: 0.92,
        strategy: "time_proximity",
        issueFingerprint,
        requiresReview: false,
      };
    }
  }

  let bestCandidate: ThreadMatchCandidate | null = null;
  let bestScore = 0;
  for (const candidate of input.candidates) {
    const sourceText = candidate.issueFingerprint ?? candidate.summary ?? "";
    const score = jaccardSimilarity(issueFingerprint, sourceText);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate && bestScore >= LOW_CONFIDENCE_THRESHOLD) {
    return {
      threadId: bestCandidate.id,
      confidence: bestScore,
      strategy: "fingerprint",
      issueFingerprint,
      requiresReview: bestScore < HIGH_CONFIDENCE_THRESHOLD,
    };
  }

  return {
    threadId: null,
    confidence: bestScore,
    strategy: "new_thread",
    issueFingerprint,
    requiresReview: false,
  };
}

export function shouldEnqueueResolutionWorkflow(
  decision: MatchDecision,
  candidateCount: number,
): boolean {
  if (candidateCount <= 0) return false;

  if (decision.strategy === "fingerprint") {
    return decision.requiresReview;
  }

  if (decision.strategy === "new_thread") {
    return true;
  }

  return false;
}

