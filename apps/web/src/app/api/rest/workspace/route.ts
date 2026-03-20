import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const trpc = createCaller(createTRPCContext());
  const workspaces = await trpc.workspace.listByUser({ userId });
  return NextResponse.json(workspaces);
}

export async function POST(req: Request) {
  try {
    const trpc = createCaller(createTRPCContext());
    const body = await req.json();
    const workspace = await trpc.workspace.create(body);
    return NextResponse.json(workspace, { status: 201 });
  } catch (error) {
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "CONFLICT" ? 409 : 400 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
