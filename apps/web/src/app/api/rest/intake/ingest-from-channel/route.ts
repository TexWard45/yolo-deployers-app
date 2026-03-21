import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json();
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.intake.ingestFromChannel(body);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TRPCError) {
      const status =
        error.code === "NOT_FOUND" ? 404
        : error.code === "BAD_REQUEST" ? 400
        : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[intake/ingest-from-channel] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
