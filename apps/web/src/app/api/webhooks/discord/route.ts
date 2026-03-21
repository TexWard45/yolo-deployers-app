import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@shared/database";
import { createCaller, createTRPCContext } from "@shared/rest";
import { DiscordChannelConfigSchema } from "@shared/types";
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

    // Find the channel connection by Discord guild
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

    // Infer Discord thread messages from channel id:
    // - If channel_id is in configured root channels -> regular channel message
    // - Otherwise treat it as a Discord thread channel id and persist as externalThreadId
    const parsedConfig = DiscordChannelConfigSchema.safeParse(channelConnection.configJson);
    const inferredExternalThreadId =
      parsedConfig.success
        ? (parsedConfig.data.channelIds.includes(payload.channel_id) ? null : payload.channel_id)
        : null;

    // Ingest via the unified performIngestion path
    const trpc = createCaller(createTRPCContext());
    const result = await trpc.intake.ingestFromChannel({
      channelConnectionId: channelConnection.id,
      externalMessageId: payload.id,
      externalUserId: payload.author.id,
      username: payload.author.username,
      displayName: payload.author.global_name ?? payload.author.username,
      body: payload.content,
      timestamp: payload.timestamp,
      rawPayload: {
        authorId: payload.author.id,
        username: payload.author.username,
        channelId: payload.channel_id,
        guildId: payload.guild_id,
      },
      externalThreadId: inferredExternalThreadId,
      inReplyToExternalMessageId: payload.message_reference?.message_id ?? null,
    });

    return NextResponse.json({ ok: true, threadId: result.thread.id });
  } catch (error) {
    console.error("Discord webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
