import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const before = searchParams.get("before");
    const after = searchParams.get("after");

    const trpc = createCaller(createTRPCContext());

    // If before/after params are present, return context view
    if (before !== null || after !== null) {
      const context = await trpc.codex.chunk.context({
        id,
        before: before ? Number(before) : 2,
        after: after ? Number(after) : 2,
      });
      return NextResponse.json(context);
    }

    const chunk = await trpc.codex.chunk.get({ id });
    return NextResponse.json(chunk);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
