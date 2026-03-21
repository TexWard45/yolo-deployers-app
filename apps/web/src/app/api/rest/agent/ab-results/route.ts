import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const userId = url.searchParams.get("userId");
    const phase = url.searchParams.get("phase") as "sentry" | "rerank" | "context_expansion" | "combined" | undefined;
    const limit = url.searchParams.get("limit");

    if (!workspaceId || !userId) {
      return NextResponse.json({ error: "workspaceId and userId are required" }, { status: 400 });
    }

    const trpc = createCaller(createTRPCContext());
    const result = await trpc.agent.getABResults({
      workspaceId,
      userId,
      phase: phase || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TRPCError) {
      const status = error.code === "FORBIDDEN" ? 403 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[agent/ab-results] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
