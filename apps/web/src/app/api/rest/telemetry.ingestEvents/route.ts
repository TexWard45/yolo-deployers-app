import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { dispatchSessionEnrichment } from "@/lib/temporal";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_APP_URL || "https://your-production-app.com"
      : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const payload = body["0"]?.json || body;

    const trpc = createCaller(createTRPCContext());
    const result = await trpc.telemetry.ingestEvents({
      sessionId: payload.sessionId,
      userId: payload.userId,
      userAgent: payload.userAgent ?? req.headers.get("user-agent") ?? undefined,
      events: payload.events,
    });

    // Fire-and-forget: trigger enrichment workflow; don't block or fail on Temporal errors
    dispatchSessionEnrichment(result.sessionId).catch((err: unknown) => {
      console.warn("[Telemetry] Failed to dispatch enrichment workflow:", err);
    });

    return NextResponse.json({ ingested: result.ingested }, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "BAD_REQUEST" ? 400 : 500, headers: CORS_HEADERS }
      );
    }
    console.error("[Telemetry Ingest Error]:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
