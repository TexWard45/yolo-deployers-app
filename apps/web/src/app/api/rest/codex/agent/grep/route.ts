import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function POST(req: Request) {
  try {
    const trpc = createCaller(createTRPCContext());
    const body = await req.json();
    const results = await trpc.codex.agent.grepRelevantCode(body);
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof TRPCError) {
      const status = error.code === "BAD_REQUEST" ? 400
        : error.code === "NOT_FOUND" ? 404
        : error.code === "INTERNAL_SERVER_ERROR" ? 500
        : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[codex/agent/grep] unhandled error:", error);
    return NextResponse.json(
      { error: message, code: "INTERNAL_SERVER_ERROR" },
      { status: 500 },
    );
  }
}
