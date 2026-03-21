export interface SegmentableMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "SYSTEM";
  body: string;
  createdAt: Date;
  externalMessageId?: string | null;
  inReplyToExternalMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface MessageSegment {
  id: string;
  label: string;
  messages: SegmentableMessage[];
}

function toTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function groupMessagesIntoSegments(messages: SegmentableMessage[]): MessageSegment[] {
  const ordered = [...messages].sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
  const segments: MessageSegment[] = [];
  const segmentMap = new Map<string, MessageSegment>();
  const externalMessageToSegment = new Map<string, string>();

  for (const message of ordered) {
    let segmentId: string | null = null;

    if (message.inReplyToExternalMessageId) {
      segmentId = externalMessageToSegment.get(message.inReplyToExternalMessageId) ?? null;
    }

    // Each new inbound message without explicit reply context starts a new linked segment.
    if (!segmentId && message.direction === "INBOUND") {
      segmentId = `segment-${segments.length + 1}`;
      const newSegment: MessageSegment = {
        id: segmentId,
        label: `Thread ${segments.length + 1}`,
        messages: [],
      };
      segments.push(newSegment);
      segmentMap.set(newSegment.id, newSegment);
    }

    // Outbound/system messages without context attach to the latest segment.
    if (!segmentId) {
      const latest = segments[segments.length - 1];
      if (!latest) {
        segmentId = "segment-1";
        const newSegment: MessageSegment = {
          id: segmentId,
          label: "Thread 1",
          messages: [],
        };
        segments.push(newSegment);
        segmentMap.set(newSegment.id, newSegment);
      } else {
        segmentId = latest.id;
      }
    }

    const segment = segmentMap.get(segmentId);
    if (!segment) continue;
    segment.messages.push(message);

    if (message.externalMessageId) {
      externalMessageToSegment.set(message.externalMessageId, segment.id);
    }
  }

  return segments;
}

export function getDefaultReplySegmentId(segments: MessageSegment[]): string | null {
  const latest = segments[segments.length - 1];
  return latest?.id ?? null;
}

export function getReplyToExternalMessageId(segment: MessageSegment | null): string | undefined {
  if (!segment) return undefined;
  const reverse = [...segment.messages].reverse();
  for (const message of reverse) {
    if (message.externalMessageId) return message.externalMessageId;
  }
  return undefined;
}
