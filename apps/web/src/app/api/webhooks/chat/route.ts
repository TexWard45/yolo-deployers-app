import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@shared/database";
import { createCaller, createTRPCContext } from "@shared/rest";
import { z } from "zod";

const InAppChatPayloadSchema = z.object({
  workspaceId: z.string(),
  sessionId: z.string(),
  sender: z.object({
    id: z.string(),
    displayName: z.string().optional(),
    email: z.string().optional(),
  }),
  message: z.object({
    id: z.string(),
    body: z.string().min(1),
    timestamp: z.string(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    const parsed = InAppChatPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    // Find the active in-app channel connection for this workspace
    const channelConnection = await prisma.channelConnection.findFirst({
      where: {
        workspaceId: payload.workspaceId,
        type: "IN_APP",
        status: "active",
      },
    });

    if (!channelConnection) {
      return NextResponse.json(
        { error: "No active in-app channel connection for this workspace" },
        { status: 404 }
      );
    }

    // Ingest via the unified performIngestion path
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.intake.ingestFromChannel({
      channelConnectionId: channelConnection.id,
      externalMessageId: payload.message.id,
      externalUserId: payload.sender.id,
      username: null,
      displayName: payload.sender.displayName ?? payload.sender.id,
      body: payload.message.body,
      timestamp: payload.message.timestamp,
      rawPayload: {
        senderId: payload.sender.id,
        sessionId: payload.sessionId,
      },
      externalThreadId: payload.sessionId,
      inReplyToExternalMessageId: null,
    });

    return NextResponse.json({ ok: true, threadId: result.thread.id });
  } catch (error) {
    console.error("In-app chat webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
