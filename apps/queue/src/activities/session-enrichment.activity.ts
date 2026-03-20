import { prisma } from "@shared/database";
import type { Prisma } from "@shared/types/prisma";

const RRWEB_INCREMENTAL_SNAPSHOT = 3;
const RRWEB_MOUSE_INTERACTION = 2;

interface RrwebPayload {
  type: number;
  data?: {
    source?: number;
    type?: number;
  };
}

export async function processSessionEnrichment(sessionId: string): Promise<void> {
  const events = await prisma.replayEvent.findMany({
    where: { sessionId },
    orderBy: { sequence: "asc" },
  });

  if (events.length === 0) return;

  const timelineEntries: Array<{
    sessionId: string;
    type: string;
    content: string;
    metadata: Prisma.InputJsonValue;
    timestamp: Date;
  }> = [];

  // Session summary
  const firstEvent = events[0]!;
  const lastEvent = events[events.length - 1]!;
  const durationMs = lastEvent.timestamp.getTime() - firstEvent.timestamp.getTime();
  const durationSec = Math.round(durationMs / 1000);

  timelineEntries.push({
    sessionId,
    type: "session_summary",
    content: `Session lasted ${durationSec}s with ${events.length} events captured.`,
    metadata: { eventCount: events.length, durationMs } as Prisma.InputJsonValue,
    timestamp: firstEvent.timestamp,
  });

  // Extract click events
  let clickCount = 0;
  for (const event of events) {
    const payload = event.payload as unknown as RrwebPayload;
    if (
      payload.type === RRWEB_INCREMENTAL_SNAPSHOT &&
      payload.data?.source === RRWEB_MOUSE_INTERACTION
    ) {
      clickCount++;
      timelineEntries.push({
        sessionId,
        type: "click",
        content: `Click interaction #${clickCount}`,
        metadata: { clickType: payload.data.type } as Prisma.InputJsonValue,
        timestamp: event.timestamp,
      });
    }
  }

  if (timelineEntries.length > 0) {
    await prisma.sessionTimeline.deleteMany({ where: { sessionId } });
    await prisma.sessionTimeline.createMany({ data: timelineEntries });
  }
}
