import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = await req.json();
    const trpc = createCaller(createTRPCContext());

    const result = await trpc.channelConnection.updateChannels({
      channelConnectionId: id,
      channelIds: body.channelIds,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TRPCError) {
      const status =
        error.code === "NOT_FOUND" ? 404
        : error.code === "BAD_REQUEST" ? 400
        : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[channel-connection/update-channels] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
