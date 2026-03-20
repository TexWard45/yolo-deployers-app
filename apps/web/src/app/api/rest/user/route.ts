import { NextResponse } from "next/server";
import { createCaller, createTRPCContext } from "@shared/rest";

export async function GET() {
  const trpc = createCaller(createTRPCContext());
  const users = await trpc.user.list();
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const trpc = createCaller(createTRPCContext());
  const body = await req.json();
  const user = await trpc.user.create(body);
  return NextResponse.json(user, { status: 201 });
}
