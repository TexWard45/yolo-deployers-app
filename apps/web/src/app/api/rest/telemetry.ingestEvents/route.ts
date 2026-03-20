import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";
import { dispatchSessionEnrichment } from "@/lib/temporal";

function getCorsHeaders(): Record<string, string> {
  if (process.env.NODE_ENV === "production") {
    const origin = process.env.NEXT_PUBLIC_APP_URL;
    if (!origin) {
      throw new Error("NEXT_PUBLIC_APP_URL must be set in production");
    }
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function POST(req: Request) {
  try {
    const corsHeaders = getCorsHeaders();
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

    return NextResponse.json({ ingested: result.ingested }, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof Error && error.message.includes("NEXT_PUBLIC_APP_URL")) {
      console.error("[Telemetry] CORS config error:", error.message);
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "BAD_REQUEST" ? 400 : 500 }
      );
    }
    console.error("[Telemetry Ingest Error]:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function OPTIONS() {
  try {
    return new Response(null, { status: 204, headers: getCorsHeaders() });
  } catch {
    return new Response(null, { status: 500 });
  }
}
