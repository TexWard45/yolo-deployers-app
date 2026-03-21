import assert from "node:assert/strict";
import test from "node:test";
import { decideDeterministicThreadMatch, type ThreadMatchCandidate } from "./thread-matching";

interface SimulatedMessage {
  externalMessageId: string;
  inReplyToExternalMessageId?: string;
  body: string;
  threadId: string;
}

const DEFAULT_CUSTOMER_ID = "cust-1";
const DEFAULT_RECENCY_MS = 10 * 60 * 1000;

class InMemoryMatcherHarness {
  private threads: ThreadMatchCandidate[] = [];
  private messages: SimulatedMessage[] = [];
  private nextThreadId = 1;

  ingest(input: {
    body: string;
    externalThreadId?: string;
    externalMessageId: string;
    inReplyToExternalMessageId?: string;
    customerId?: string;
  }): string {
    const customerId = input.customerId ?? DEFAULT_CUSTOMER_ID;

    const existingThreadByExternalId =
      input.externalThreadId
        ? this.threads.find((thread) => thread.externalThreadId === input.externalThreadId) ?? null
        : null;

    const replyChainThreadId =
      input.inReplyToExternalMessageId
        ? this.messages.find((message) => message.externalMessageId === input.inReplyToExternalMessageId)?.threadId ??
          null
        : null;

    const decision = decideDeterministicThreadMatch({
      externalThreadId: input.externalThreadId ?? null,
      inReplyToExternalMessageId: input.inReplyToExternalMessageId ?? null,
      threadGroupingHint: null,
      messageBody: input.body,
      customerId,
      recencyWindowMs: DEFAULT_RECENCY_MS,
      existingThreadByExternalId,
      threadIdByReplyChain: replyChainThreadId,
      candidates: this.threads,
    });

    const threadId =
      decision.threadId ??
      this.createThread(input.externalThreadId, decision.issueFingerprint, input.body, customerId);
    this.messages.push({
      externalMessageId: input.externalMessageId,
      inReplyToExternalMessageId: input.inReplyToExternalMessageId,
      body: input.body,
      threadId,
    });

    return threadId;
  }

  private createThread(
    externalThreadId: string | undefined,
    issueFingerprint: string,
    summary: string,
    customerId: string,
  ): string {
    const id = `thread-${this.nextThreadId++}`;
    this.threads.push({
      id,
      customerId,
      externalThreadId: externalThreadId ?? `synthetic-${id}`,
      issueFingerprint,
      summary,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(), // within recency window — time-proximity will group
    });
    return id;
  }
}

test("e2e: rapid-fire messages from same customer all group into one thread", () => {
  const harness = new InMemoryMatcherHarness();

  const t1 = harness.ingest({ body: "lu your code is trash", externalMessageId: "m1" });
  const t2 = harness.ingest({ body: "need fix asap", externalMessageId: "m2" });
  const t3 = harness.ingest({ body: "who wrote this trash code on settings", externalMessageId: "m3" });
  const t4 = harness.ingest({ body: "i need to fix this", externalMessageId: "m4" });

  // All should land on thread-1 via time-proximity (same customer, within window)
  assert.equal(t1, "thread-1");
  assert.equal(t2, t1);
  assert.equal(t3, t1);
  assert.equal(t4, t1);
});

test("e2e: reply chain overrides time-proximity", () => {
  const harness = new InMemoryMatcherHarness();

  const t1 = harness.ingest({ body: "webhook failures", externalMessageId: "m1" });
  const t2 = harness.ingest({
    body: "can you share a request id",
    externalMessageId: "m2",
    inReplyToExternalMessageId: "m1",
  });

  assert.equal(t2, t1);
});
