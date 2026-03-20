import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultReplySegmentId,
  getReplyToExternalMessageId,
  groupMessagesIntoSegments,
} from "./message-segments";

test("groups inbound roots into linked thread segments", () => {
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
      body: "can you share details?",
      createdAt: new Date("2026-03-21T10:02:00.000Z"),
      inReplyToExternalMessageId: "ext-2",
    },
  ]);

  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.messages.length, 1);
  assert.equal(segments[1]?.messages.length, 2);
});

test("default reply target and reply external id resolve to latest segment", () => {
  const segments = groupMessagesIntoSegments([
    {
      id: "m1",
      direction: "INBOUND",
      body: "first",
      createdAt: new Date("2026-03-21T10:00:00.000Z"),
      externalMessageId: "ext-1",
    },
    {
      id: "m2",
      direction: "INBOUND",
      body: "second",
      createdAt: new Date("2026-03-21T10:05:00.000Z"),
      externalMessageId: "ext-2",
    },
  ]);

  const active = getDefaultReplySegmentId(segments);
  assert.equal(active, "segment-2");
  const segment = segments.find((item) => item.id === active) ?? null;
  assert.equal(getReplyToExternalMessageId(segment), "ext-2");
});
