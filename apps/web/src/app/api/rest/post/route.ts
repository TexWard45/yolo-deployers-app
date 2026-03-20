import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const userId = searchParams.get("userId");

  if (!workspaceId || !userId) {
    return NextResponse.json(
      { error: "workspaceId and userId required" },
      { status: 400 }
    );
  }

  const trpc = createCaller(createTRPCContext());
  const posts = await trpc.post.list({ workspaceId, userId });
  return NextResponse.json(posts);
}

export async function POST(req: Request) {
  const trpc = createCaller(createTRPCContext());
  const body = await req.json();
  const post = await trpc.post.create(body);
  return NextResponse.json(post, { status: 201 });
}
