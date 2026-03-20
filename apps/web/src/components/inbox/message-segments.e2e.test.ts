import assert from "node:assert/strict";
import test from "node:test";
import { groupMessagesIntoSegments } from "./message-segments";

test("e2e timeline grouping keeps related back-and-forth in selected linked thread", () => {
  const segments = groupMessagesIntoSegments([
    {
      id: "m1",
      direction: "INBOUND",
      body: "hey",
      createdAt: new Date("2026-03-21T10:00:00.000Z"),
      externalMessageId: "ext-1",
    },
    {
      id: "m2",
      direction: "INBOUND",
      body: "i have this issue",
      createdAt: new Date("2026-03-21T10:01:00.000Z"),
      externalMessageId: "ext-2",
    },
    {
      id: "m3",
      direction: "OUTBOUND",
      body: "can you share logs",
      createdAt: new Date("2026-03-21T10:02:00.000Z"),
      inReplyToExternalMessageId: "ext-2",
      externalMessageId: "ext-3",
    },
    {
      id: "m4",
      direction: "INBOUND",
      body: "here are logs",
      createdAt: new Date("2026-03-21T10:03:00.000Z"),
      inReplyToExternalMessageId: "ext-3",
      externalMessageId: "ext-4",
    },
    {
      id: "m5",
      direction: "INBOUND",
      body: "new issue: billing",
      createdAt: new Date("2026-03-21T10:04:00.000Z"),
      externalMessageId: "ext-5",
    },
  ]);

  assert.equal(segments.length, 3);
  assert.equal(segments[1]?.messages.length, 3);
  assert.equal(segments[2]?.messages.length, 1);
  assert.equal(segments[1]?.label, "Thread 2");
  assert.equal(segments[2]?.label, "Thread 3");
});
