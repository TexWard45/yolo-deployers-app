import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@shared/database";
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

    // Check for idempotency
    const existing = await prisma.conversationMessage.findFirst({
      where: {
        channelConnectionId: channelConnection.id,
        externalMessageId: payload.message.id,
      },
    });

    if (existing) {
      return NextResponse.json({ ok: true, skipped: "duplicate" });
    }

    // Upsert customer identity
    let identity = await prisma.customerChannelIdentity.findUnique({
      where: {
        channelConnectionId_externalUserId: {
          channelConnectionId: channelConnection.id,
          externalUserId: payload.sender.id,
        },
      },
      include: { customerProfile: true },
    });

    if (!identity) {
      const profile = await prisma.customerProfile.create({
        data: {
          workspaceId: payload.workspaceId,
          displayName: payload.sender.displayName ?? payload.sender.id,
          email: payload.sender.email,
        },
      });

      identity = await prisma.customerChannelIdentity.create({
        data: {
          customerProfileId: profile.id,
          channelConnectionId: channelConnection.id,
          externalUserId: payload.sender.id,
          displayName: payload.sender.displayName,
        },
        include: { customerProfile: true },
      });
    }

    // Find or create conversation based on session
    let conversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: payload.workspaceId,
        customerProfileId: identity.customerProfileId,
        primaryChannelType: "IN_APP",
        externalThreadId: payload.sessionId,
        status: { notIn: ["CLOSED"] },
      },
    });

    const now = new Date();

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          workspaceId: payload.workspaceId,
          customerProfileId: identity.customerProfileId,
          primaryChannelType: "IN_APP",
          status: "NEW",
          externalThreadId: payload.sessionId,
          subject: payload.message.body.slice(0, 100),
          lastMessageAt: now,
          lastInboundAt: now,
        },
      });
    } else {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          lastInboundAt: now,
          status: "NEW",
        },
      });
    }

    // Store the inbound message
    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        channelConnectionId: channelConnection.id,
        direction: "INBOUND",
        senderKind: "CUSTOMER",
        externalMessageId: payload.message.id,
        body: payload.message.body,
        rawPayloadJson: JSON.parse(JSON.stringify(payload)),
        sentAt: new Date(payload.message.timestamp),
      },
    });

    // TODO: Optionally trigger AI draft generation workflow via Temporal

    return NextResponse.json({ ok: true, conversationId: conversation.id });
  } catch (error) {
    console.error("In-app chat webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
