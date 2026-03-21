import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@shared/database";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  
  // If no sessionId, list all sessions with their first event info
  if (!sessionId) {
    const sessions = await prisma.session.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { _count: { select: { events: true } } },
    });
    
    const result = [];
    for (const s of sessions) {
      const firstEvent = await prisma.replayEvent.findFirst({
        where: { sessionId: s.id },
        orderBy: { sequence: "asc" },
      });
      result.push({
        id: s.id,
        createdAt: s.createdAt,
        eventCount: s._count.events,
        firstSeq: firstEvent?.sequence ?? null,
        firstType: firstEvent ? (firstEvent.payload as any)?.type : null,
        firstTypeLabel: firstEvent
          ? ({ 0: "DomContentLoaded", 1: "Load", 2: "FullSnapshot", 3: "IncrementalSnapshot", 4: "Meta" } as Record<number, string>)[(firstEvent.payload as any)?.type as number] ?? "Unknown"
          : null,
      });
    }
    return NextResponse.json({ sessions: result });
  }

  // Existing: show first 5 events for a specific session
  const events = await prisma.replayEvent.findMany({
    where: { sessionId },
    orderBy: { sequence: "asc" },
    take: 5,
  });

  const total = await prisma.replayEvent.count({ where: { sessionId } });

  const summary = events.map((e: any) => {
    const p = e.payload as any;
    return {
      seq: e.sequence,
      dbType: e.type,
      rrwebType: p?.type,
      label:
        p?.type === 0 ? "DomContentLoaded" :
        p?.type === 1 ? "Load" :
        p?.type === 2 ? "FullSnapshot" :
        p?.type === 3 ? "IncrementalSnapshot" :
        p?.type === 4 ? "Meta" :
        p?.type === 5 ? "Custom" : `Unknown(${p?.type})`,
      timestamp: p?.timestamp,
      dataKeys: p?.data ? Object.keys(p.data) : [],
      hasNode: !!p?.data?.node,
      nodeChildCount: p?.data?.node?.childNodes?.length ?? 0,
      payloadSize: JSON.stringify(p).length,
    };
  });

  return NextResponse.json({ sessionId, total, first5: summary });
}
