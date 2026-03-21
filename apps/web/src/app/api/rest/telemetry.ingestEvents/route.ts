import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { dispatchSessionEnrichment } from "@/lib/temporal";

// App Router uses the native Web API Request.json() which has no body
// size limit, so large FullSnapshot payloads are handled automatically.
export const maxDuration = 30;

// Safe fallback CORS origin — deferred to request time so the build step
// doesn't throw when NEXT_PUBLIC_APP_URL is absent during `next build`.
function getCorsHeaders() {
  const origin =
    process.env.NODE_ENV === "production"
      ? process.env.NEXT_PUBLIC_APP_URL ?? "*"
      : "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } as const;
}

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

    return NextResponse.json({ ingested: result.ingested }, { headers: getCorsHeaders() });
  } catch (error) {
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "BAD_REQUEST" ? 400 : 500, headers: getCorsHeaders() }
      );
    }
    console.error("[Telemetry Ingest Error]:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: getCorsHeaders() }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: getCorsHeaders() });
}
