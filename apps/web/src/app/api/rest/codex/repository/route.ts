import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const trpc = createCaller(createTRPCContext());
  const repositories = await trpc.codex.repository.list({ workspaceId });
  return NextResponse.json(repositories);
}

export async function POST(req: Request) {
  try {
    const trpc = createCaller(createTRPCContext());
    const body = await req.json();
    const repository = await trpc.codex.repository.create(body);
    return NextResponse.json(repository, { status: 201 });
  } catch (error) {
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "CONFLICT" ? 409 : 400 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
