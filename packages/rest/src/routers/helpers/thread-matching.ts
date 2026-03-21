export type MatchStrategy =
  | "external_thread_id"
  | "reply_chain"
  | "awaiting_customer_response"
  | "time_proximity"
  | "new_thread";

export interface ThreadMatchCandidate {
  id: string;
  customerId: string;
  externalThreadId: string;
  issueFingerprint: string | null;
  summary: string | null;
  status: string;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
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
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "have", "hello", "hey", "hi", "i", "in", "is", "it", "me", "my",
  "of", "on", "or", "our", "that", "the", "this", "to", "we", "with",
  "you", "your",
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
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

export function buildThreadSummary(previousSummary: string | null, incomingMessage: string): string {
  const cleanIncoming = incomingMessage.trim().replace(/\s+/g, " ");
  const boundedIncoming = cleanIncoming.slice(0, 180);

  if (!previousSummary || previousSummary.trim().length === 0) {
    return boundedIncoming;
  }

  const merged = `${previousSummary.trim()} | ${boundedIncoming}`;
  return merged.length > 220 ? merged.slice(0, 220) : merged;
}

/**
 * Deterministic thread matching — fast, no LLM.
 * Strategies: external_thread_id → reply_chain → awaiting_customer_response → time_proximity → new_thread.
 * Jaccard/LLM matching removed — handled by async review workflow instead.
 */
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
    };
  }

  if (input.inReplyToExternalMessageId && input.threadIdByReplyChain) {
    return {
      threadId: input.threadIdByReplyChain,
      confidence: 0.96,
      strategy: "reply_chain",
      issueFingerprint,
    };
  }

  // Awaiting customer response: same customer has a thread where we sent a reply and are waiting
  if (!input.externalThreadId && !input.inReplyToExternalMessageId) {
    const awaitingThreads = input.candidates.filter(
      (c) => c.status === "WAITING_CUSTOMER" && c.customerId === input.customerId,
    );

    if (awaitingThreads.length > 0) {
      // Pick the thread with the most recent outbound (most recently asked question)
      const best = awaitingThreads.reduce((a, b) => {
        const aTs = a.lastOutboundAt?.getTime() ?? 0;
        const bTs = b.lastOutboundAt?.getTime() ?? 0;
        return bTs > aTs ? b : a;
      });

      return {
        threadId: best.id,
        confidence: 0.95,
        strategy: "awaiting_customer_response",
        issueFingerprint,
      };
    }
  }

  // Time-proximity: any recent thread in the workspace, no explicit new thread boundary
  // Groups messages from ANY user within the recency window into the most recent thread
  if (input.recencyWindowMs > 0 && !input.externalThreadId) {
    const now = Date.now();
    let recentCandidate: ThreadMatchCandidate | null = null;
    let recentTime = 0;

    for (const candidate of input.candidates) {
      // Use lastMessageAt (slides forward with each message) for recency check
      const msgTs = candidate.lastMessageAt?.getTime() ?? candidate.lastInboundAt?.getTime() ?? 0;
      if (msgTs > 0 && now - msgTs <= input.recencyWindowMs && msgTs > recentTime) {
        recentCandidate = candidate;
        recentTime = msgTs;
      }
    }

    if (recentCandidate) {
      return {
        threadId: recentCandidate.id,
        confidence: 0.92,
        strategy: "time_proximity",
        issueFingerprint,
      };
    }
  }

  return {
    threadId: null,
    confidence: 0,
    strategy: "new_thread",
    issueFingerprint,
  };
}
