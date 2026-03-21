import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@shared/database";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

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
      containsCSS: JSON.stringify(p).length > 1000 ? JSON.stringify(p).slice(0, 500).includes("style") : false,
    };
  });

  return NextResponse.json({ sessionId, total, first5: summary });
}
