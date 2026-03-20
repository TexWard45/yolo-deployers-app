import { NextResponse } from "next/server";
import { prisma } from "@shared/database";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.NODE_ENV === "production" ? (process.env.NEXT_PUBLIC_APP_URL || "https://your-production-app.com") : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const payload = body["0"]?.json || body;
    const { sessionId, events, userId, userAgent } = payload;

    if (!sessionId || !events || !Array.isArray(events)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: CORS_HEADERS });
    }

    // Upsert session and create events in one transaction
    await prisma.$transaction([
      prisma.session.upsert({
        where: { id: sessionId },
        update: {},
        create: {
          id: sessionId,
          userId: userId || null,
          userAgent: userAgent || req.headers.get("user-agent") || null,
        },
      }),
      prisma.replayEvent.createMany({
        data: events.map((event: any) => ({
          sessionId,
          type: String(event.type || "unknown"),
          timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          payload: event.payload || event.data || {},
          sequence: event.sequence ?? 0,
        })),
      }),
    ]);

    return NextResponse.json(
      { ingested: events.length },
      { headers: CORS_HEADERS }
    );
  } catch (error: any) {
    console.error("[Telemetry Ingest Error]:", error);
    
    const errorResponse = {
      error: "Internal Server Error",
      ...(process.env.NODE_ENV === "development" ? { 
        message: error.message,
        stack: error.stack 
      } : {})
    };

    return NextResponse.json(
      errorResponse,
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
