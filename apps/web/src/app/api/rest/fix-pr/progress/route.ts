import { NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { webEnv } from "@shared/env/web";

export async function POST(req: Request): Promise<NextResponse> {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== webEnv.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.agent.saveFixPRProgress(body);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TRPCError) {
      const status =
        error.code === "NOT_FOUND" ? 404
        : error.code === "BAD_REQUEST" ? 400
        : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("[fix-pr/progress] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
