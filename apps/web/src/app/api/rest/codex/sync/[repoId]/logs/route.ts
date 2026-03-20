import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";

interface RouteParams {
  params: Promise<{ repoId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { repoId } = await params;
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit");

  const trpc = createCaller(createTRPCContext());
  const logs = await trpc.codex.sync.logs({
    repositoryId: repoId,
    ...(limit ? { limit: Number(limit) } : {}),
  });
  return NextResponse.json(logs);
}
