// @ts-nocheck — references schema models not yet migrated
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@shared/database";
import { z } from "zod";

const DiscordWebhookPayloadSchema = z.object({
  type: z.number(),
  channel_id: z.string(),
  guild_id: z.string().optional(),
  author: z.object({
    id: z.string(),
    username: z.string(),
    global_name: z.string().nullable().optional(),
    bot: z.boolean().optional(),
  }),
  content: z.string(),
  id: z.string(),
  timestamp: z.string(),
  message_reference: z
    .object({
      message_id: z.string().optional(),
      channel_id: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    // Discord interaction verification ping
    if (typeof body === "object" && body !== null && "type" in body && (body as { type: number }).type === 1) {
      return NextResponse.json({ type: 1 });
    }

    const parsed = DiscordWebhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    // Ignore bot messages to prevent loops
    if (payload.author.bot) {
      return NextResponse.json({ ok: true, skipped: "bot_message" });
    }

    // Find the channel connection by Discord channel/guild
    const channelConnection = await prisma.channelConnection.findFirst({
      where: {
        type: "DISCORD",
        status: "active",
        externalAccountId: payload.guild_id ?? payload.channel_id,
      },
    });

    if (!channelConnection) {
      return NextResponse.json(
        { error: "No active channel connection found for this Discord source" },
        { status: 404 }
      );
    }

    // Check for idempotency — skip if message already ingested
    const existing = await prisma.conversationMessage.findFirst({
      where: {
        channelConnectionId: channelConnection.id,
        externalMessageId: payload.id,
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
          externalUserId: payload.author.id,
        },
      },
      include: { customerProfile: true },
    });

    if (!identity) {
      const profile = await prisma.customerProfile.create({
        data: {
          workspaceId: channelConnection.workspaceId,
          displayName: payload.author.global_name ?? payload.author.username,
        },
      });

      identity = await prisma.customerChannelIdentity.create({
        data: {
          customerProfileId: profile.id,
          channelConnectionId: channelConnection.id,
          externalUserId: payload.author.id,
          username: payload.author.username,
          displayName: payload.author.global_name ?? payload.author.username,
        },
        include: { customerProfile: true },
      });
    }

    // Find or create conversation
    // If the message is inside a thread we already track, map it back
    let conversation = await prisma.conversation.findFirst({
      where: {
        workspaceId: channelConnection.workspaceId,
        customerProfileId: identity.customerProfileId,
        externalThreadId: payload.channel_id,
        status: { notIn: ["CLOSED"] },
      },
    });

    if (!conversation) {
      // Also check for an open conversation without a thread
      conversation = await prisma.conversation.findFirst({
        where: {
          workspaceId: channelConnection.workspaceId,
          customerProfileId: identity.customerProfileId,
          status: { notIn: ["CLOSED"] },
          primaryChannelType: "DISCORD",
        },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      });
    }

    const now = new Date();

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          workspaceId: channelConnection.workspaceId,
          customerProfileId: identity.customerProfileId,
          primaryChannelType: "DISCORD",
          status: "NEW",
          subject: payload.content.slice(0, 100),
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
        externalMessageId: payload.id,
        body: payload.content,
        rawPayloadJson: JSON.parse(JSON.stringify(payload)),
        sentAt: new Date(payload.timestamp),
      },
    });

    // TODO: Optionally trigger AI draft generation workflow via Temporal
    // if WorkspaceAgentConfig.autoDraftOnInbound is true

    return NextResponse.json({ ok: true, conversationId: conversation.id });
  } catch (error) {
    console.error("Discord webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
