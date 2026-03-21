import assert from "node:assert/strict";
import test from "node:test";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  buildIssueFingerprint,
  buildThreadSummary,
  decideDeterministicThreadMatch,
  jaccardSimilarity,
  shouldEnqueueResolutionWorkflow,
} from "./thread-matching";

const DEFAULT_RECENCY_MS = 10 * 60 * 1000;

test("buildIssueFingerprint strips noise and keeps stable tokens", () => {
  const fingerprint = buildIssueFingerprint(
    "Hey team, I have this issue with webhook delivery failing in production",
  );

  assert.ok(fingerprint.includes("webhook"));
  assert.ok(fingerprint.includes("issue"));
  assert.ok(fingerprint.includes("production"));
  assert.ok(!fingerprint.includes("hey"));
});

test("jaccardSimilarity is high for semantically-close token sets", () => {
  const score = jaccardSimilarity(
    "webhook delivery failure timeout",
    "delivery webhook timeout failure",
  );

  assert.ok(score >= HIGH_CONFIDENCE_THRESHOLD);
});

test("deterministic match prefers external thread id", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: "ext-thread-1",
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "customer follow-up",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: {
      id: "thread-1",
      customerId: "cust-1",
      externalThreadId: "ext-thread-1",
      issueFingerprint: "webhook delivery failure",
      summary: "webhook issue",
      lastMessageAt: new Date(),
      lastInboundAt: new Date(),
    },
    threadIdByReplyChain: null,
    candidates: [],
  });

  assert.equal(decision.threadId, "thread-1");
  assert.equal(decision.strategy, "external_thread_id");
  assert.equal(decision.requiresReview, false);
});

test("deterministic match uses similarity candidate with review flag when medium confidence", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "webhook retries timeout failures in production still ongoing",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "webhook retries timeout failures production ongoing",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago (outside recency)
      },
      {
        id: "thread-2",
        customerId: "cust-1",
        externalThreadId: "ext-2",
        issueFingerprint: "billing refund request invoice duplicate",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.threadId, "thread-1");
  assert.equal(decision.strategy, "fingerprint");
  assert.ok(decision.confidence >= LOW_CONFIDENCE_THRESHOLD);
  assert.equal(decision.requiresReview, decision.confidence < HIGH_CONFIDENCE_THRESHOLD);
});

test("deterministic new_thread decision does not require review", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "totally unrelated billing invoice dispute",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-2",
        externalThreadId: "ext-1",
        issueFingerprint: "webhook retries timeout failures production ongoing",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.strategy, "new_thread");
  assert.equal(decision.threadId, null);
  assert.equal(decision.requiresReview, false);
});

test("buildThreadSummary appends bounded context", () => {
  const summary = buildThreadSummary("Webhook errors reported", "Customer confirmed issue still ongoing");
  assert.ok(summary.includes("Webhook errors reported"));
  assert.ok(summary.includes("Customer confirmed"));
});

test("workflow enqueue policy: only ambiguous deterministic outcomes", () => {
  assert.equal(
    shouldEnqueueResolutionWorkflow(
      {
        threadId: "thread-1",
        confidence: 0.95,
        strategy: "external_thread_id",
        issueFingerprint: "webhook issue",
        requiresReview: false,
      },
      5,
    ),
    false,
  );

  assert.equal(
    shouldEnqueueResolutionWorkflow(
      {
        threadId: "thread-1",
        confidence: 0.7,
        strategy: "fingerprint",
        issueFingerprint: "webhook issue",
        requiresReview: true,
      },
      2,
    ),
    true,
  );

  assert.equal(
    shouldEnqueueResolutionWorkflow(
      {
        threadId: null,
        confidence: 0.4,
        strategy: "new_thread",
        issueFingerprint: "billing issue",
        requiresReview: false,
      },
      3,
    ),
    true,
  );
});

// ── Time-Proximity Tests ──────────────────────────────────────────

test("time-proximity: matches same-customer thread within recency window", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "i need to fix this",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "who write trash code setting page",
        summary: "who the f write this trash code on setting page",
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 3 * 60 * 1000), // 3 min ago
      },
    ],
  });

  assert.equal(decision.threadId, "thread-1");
  assert.equal(decision.strategy, "time_proximity");
  assert.equal(decision.confidence, 0.92);
  assert.equal(decision.requiresReview, false);
});

test("time-proximity: does NOT match when outside recency window", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "i need to fix this",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "who write trash code setting page",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
      },
    ],
  });

  // Should fall through to Jaccard (which won't match either), then new_thread
  assert.equal(decision.strategy, "new_thread");
  assert.equal(decision.threadId, null);
});

test("time-proximity: does NOT match different customer's thread", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "i need to fix this",
    customerId: "cust-2",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-1", // different customer
        externalThreadId: "ext-1",
        issueFingerprint: "who write trash code setting page",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 3 * 60 * 1000), // within window
      },
    ],
  });

  // Cross-customer matching is for Jaccard/LLM, not time-proximity
  assert.equal(decision.strategy, "new_thread");
});

test("time-proximity: picks most recent thread when multiple exist", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "any update?",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-old",
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "billing issue",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 8 * 60 * 1000), // 8 min ago
      },
      {
        id: "thread-recent",
        customerId: "cust-1",
        externalThreadId: "ext-2",
        issueFingerprint: "login bug",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago
      },
    ],
  });

  assert.equal(decision.threadId, "thread-recent");
  assert.equal(decision.strategy, "time_proximity");
});

test("time-proximity: skipped when externalThreadId is explicitly provided", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: "new-ext-thread",
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "i need to fix this",
    customerId: "cust-1",
    recencyWindowMs: DEFAULT_RECENCY_MS,
    existingThreadByExternalId: null, // not found in DB
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "who write trash code setting page",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    ],
  });

  // externalThreadId was provided but no existing thread found → should not time-proximity match
  assert.equal(decision.strategy, "new_thread");
});

test("time-proximity: disabled when recencyWindowMs is 0", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "i need to fix this",
    customerId: "cust-1",
    recencyWindowMs: 0, // disabled
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "who write trash code setting page",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.strategy, "new_thread");
});
