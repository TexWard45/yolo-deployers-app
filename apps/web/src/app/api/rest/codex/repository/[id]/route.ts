import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";
import { TRPCError } from "@trpc/server";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const trpc = createCaller(createTRPCContext());
    const repository = await trpc.codex.repository.get({ id });
    return NextResponse.json(repository);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const trpc = createCaller(createTRPCContext());
    const body = await req.json();
    const repository = await trpc.codex.repository.update({ ...body, id });
    return NextResponse.json(repository);
  } catch (error) {
    if (error instanceof TRPCError) {
      const status = error.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.codex.repository.delete({ id });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
