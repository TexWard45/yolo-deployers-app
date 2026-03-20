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
    existingThreadByExternalId: {
      id: "thread-1",
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
    existingThreadByExternalId: null,
    threadIdByReplyChain: null,
    candidates: [
      {
        id: "thread-1",
        externalThreadId: "ext-1",
        issueFingerprint: "webhook retries timeout failures production ongoing",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
      },
      {
        id: "thread-2",
        externalThreadId: "ext-2",
        issueFingerprint: "billing refund request invoice duplicate",
        summary: null,
        lastMessageAt: new Date(),
        lastInboundAt: new Date(),
      },
    ],
  });

  assert.equal(decision.threadId, "thread-1");
  assert.equal(decision.strategy, "fingerprint");
  assert.ok(decision.confidence >= LOW_CONFIDENCE_THRESHOLD);
  assert.equal(decision.requiresReview, decision.confidence < HIGH_CONFIDENCE_THRESHOLD);
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
