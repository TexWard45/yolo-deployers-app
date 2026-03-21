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
    // Set lastInboundAt 15 min in the past so time-proximity doesn't interfere
    // with topic-based matching tests
    this.threads.push({
      id,
      customerId,
      externalThreadId: externalThreadId ?? `synthetic-${id}`,
      issueFingerprint,
      summary,
      lastMessageAt: new Date(),
      lastInboundAt: new Date(Date.now() - 15 * 60 * 1000),
    });
    return id;
  }
}

test("e2e matching flow links related messages and splits unrelated issue", () => {
  const harness = new InMemoryMatcherHarness();

  const thread1 = harness.ingest({
    body: "we are seeing webhook delivery failures in production",
    externalMessageId: "m1",
  });

  const thread2 = harness.ingest({
    body: "still seeing webhook delivery failures in production with retries",
    externalMessageId: "m2",
  });

  const thread3 = harness.ingest({
    body: "can you share a request id",
    externalMessageId: "m3",
    inReplyToExternalMessageId: "m2",
  });

  const thread4 = harness.ingest({
    body: "separate issue: billing invoice double charge",
    externalMessageId: "m4",
  });

  assert.equal(thread2, thread1);
  assert.equal(thread3, thread1);
  assert.notEqual(thread4, thread1);
});
