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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
