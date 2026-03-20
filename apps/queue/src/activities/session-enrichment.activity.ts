import { prisma } from "@shared/database";
import type { Prisma } from "@shared/types/prisma";

// rrweb event type constants
const RRWEB_INCREMENTAL_SNAPSHOT = 3;
// rrweb IncrementalSource.MouseInteraction = 2
const RRWEB_MOUSE_INTERACTION_SOURCE = 2;
// rrweb MouseInteractions.Click = 2
const RRWEB_CLICK_TYPE = 2;

interface RrwebPayload {
  type?: number;
  data?: {
    source?: number;
    type?: number;
    x?: number;
    y?: number;
    id?: number;
  };
}

interface UiClickPayload {
  selector?: string;
  tag_name?: string;
  text?: string;
  x?: number;
  y?: number;
}

interface GenericPayload {
  traceId?: string;
  trace_id?: string;
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

  const clickInserts: Array<{
    sessionId: string;
    selector?: string;
    tagName?: string;
    text?: string;
    x?: number;
    y?: number;
    traceId?: string;
    route?: string;
    timestamp: Date;
  }> = [];

  const traceIdsFound = new Set<string>();

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

  let clickCount = 0;

  for (const event of events) {
    const payload = event.payload as unknown;
    const generic = payload as GenericPayload;

    // Collect traceIds from events
    const traceId = event.traceId ?? generic.traceId ?? generic.trace_id;
    if (traceId) traceIdsFound.add(traceId);

    // Handle rrweb incremental snapshot mouse interaction (click)
    if (event.type === "rrweb") {
      const rrweb = payload as RrwebPayload;
      if (
        rrweb.type === RRWEB_INCREMENTAL_SNAPSHOT &&
        rrweb.data?.source === RRWEB_MOUSE_INTERACTION_SOURCE &&
        rrweb.data?.type === RRWEB_CLICK_TYPE
      ) {
        clickCount++;
        clickInserts.push({
          sessionId,
          x: rrweb.data.x,
          y: rrweb.data.y,
          traceId: traceId ?? undefined,
          route: event.route ?? undefined,
          timestamp: event.timestamp,
        });
        timelineEntries.push({
          sessionId,
          type: "click",
          content: `Click #${clickCount} at (${rrweb.data.x ?? "?"}, ${rrweb.data.y ?? "?"})`,
          metadata: {
            x: rrweb.data.x,
            y: rrweb.data.y,
            nodeId: rrweb.data.id,
            traceId: traceId ?? null,
            route: event.route ?? null,
          } as Prisma.InputJsonValue,
          timestamp: event.timestamp,
        });
      }
    }

    // Handle structured ui.click events (non-rrweb format from spec)
    if (event.type === "ui.click") {
      const click = payload as UiClickPayload;
      clickCount++;
      clickInserts.push({
        sessionId,
        selector: click.selector,
        tagName: click.tag_name,
        text: click.text,
        x: click.x,
        y: click.y,
        traceId: traceId ?? undefined,
        route: event.route ?? undefined,
        timestamp: event.timestamp,
      });
      timelineEntries.push({
        sessionId,
        type: "click",
        content: `Click #${clickCount}${click.text ? ` on "${click.text}"` : ""}${click.selector ? ` (${click.selector})` : ""}`,
        metadata: {
          selector: click.selector ?? null,
          tagName: click.tag_name ?? null,
          text: click.text ?? null,
          x: click.x ?? null,
          y: click.y ?? null,
          traceId: traceId ?? null,
          route: event.route ?? null,
        } as Prisma.InputJsonValue,
        timestamp: event.timestamp,
      });
    }
  }

  // Persist everything atomically
  await prisma.$transaction(async (tx) => {
    // Clear old enrichment data for this session
    await tx.sessionTimeline.deleteMany({ where: { sessionId } });
    await tx.sessionClick.deleteMany({ where: { sessionId } });

    if (timelineEntries.length > 0) {
      await tx.sessionTimeline.createMany({ data: timelineEntries });
    }

    if (clickInserts.length > 0) {
      await tx.sessionClick.createMany({ data: clickInserts });
    }

    // Upsert trace links for all discovered traceIds
    for (const traceId of traceIdsFound) {
      await tx.sessionTraceLink.upsert({
        where: { sessionId_traceId: { sessionId, traceId } },
        update: {},
        create: { sessionId, traceId },
      });
    }
  });
}
