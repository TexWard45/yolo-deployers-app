import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueFingerprint,
  buildThreadSummary,
  decideDeterministicThreadMatch,
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
});

test("deterministic match falls to new_thread when outside recency window", () => {
  const oldTime = new Date(Date.now() - 30 * 60 * 1000);
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
        issueFingerprint: "webhook retries",
        summary: null,
        lastMessageAt: oldTime,
        lastInboundAt: oldTime,
      },
    ],
  });

  assert.equal(decision.strategy, "new_thread");
  assert.equal(decision.threadId, null);
});

test("buildThreadSummary appends bounded context", () => {
  const summary = buildThreadSummary("Webhook errors reported", "Customer confirmed issue still ongoing");
  assert.ok(summary.includes("Webhook errors reported"));
  assert.ok(summary.includes("Customer confirmed"));
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
        lastInboundAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.threadId, "thread-1");
  assert.equal(decision.strategy, "time_proximity");
  assert.equal(decision.confidence, 0.92);
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
        lastInboundAt: new Date(Date.now() - 15 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.strategy, "new_thread");
  assert.equal(decision.threadId, null);
});

test("time-proximity: matches different customer's thread within window (workspace-wide)", () => {
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
        customerId: "cust-1",
        externalThreadId: "ext-1",
        issueFingerprint: "who write trash code setting page",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.threadId, "thread-1");
  assert.equal(decision.strategy, "time_proximity");
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
        lastInboundAt: new Date(Date.now() - 8 * 60 * 1000),
      },
      {
        id: "thread-recent",
        customerId: "cust-1",
        externalThreadId: "ext-2",
        issueFingerprint: "login bug",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(Date.now() - 2 * 60 * 1000),
      },
    ],
  });

  assert.equal(decision.threadId, "thread-recent");
  assert.equal(decision.strategy, "time_proximity");
});

test("time-proximity: disabled when recencyWindowMs is 0", () => {
  const decision = decideDeterministicThreadMatch({
    externalThreadId: null,
    inReplyToExternalMessageId: null,
    threadGroupingHint: null,
    messageBody: "i need to fix this",
    customerId: "cust-1",
    recencyWindowMs: 0,
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
