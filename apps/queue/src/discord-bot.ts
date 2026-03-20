import { Client, GatewayIntentBits, Events } from "discord.js";
import { prisma } from "@shared/database";

export function startDiscordBot(botToken: string): void {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord-bot] Logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only listen to channels with "support" or "company" in their name
    const channelName = "name" in message.channel ? (message.channel.name ?? "") : "";
    // For threads, check the parent channel name
    const parentName = message.channel.isThread() && message.channel.parent
      ? ("name" in message.channel.parent ? (message.channel.parent.name ?? "") : "")
      : "";
    const nameToCheck = (channelName + " " + parentName).toLowerCase();

    if (!nameToCheck.includes("support") && !nameToCheck.includes("company")) {
      return;
    }

    const guildId = message.guildId;
    const channelId = message.channelId;

    // Find a matching channel connection
    const connection = await prisma.channelConnection.findFirst({
      where: {
        type: "DISCORD",
        status: "active",
        OR: [
          { externalAccountId: guildId },
          { externalAccountId: channelId },
        ],
      },
    });

    if (!connection) return;

    // Check for idempotency
    const existing = await prisma.conversationMessage.findFirst({
      where: {
        channelConnectionId: connection.id,
        externalMessageId: message.id,
      },
    });

    if (existing) return;

    // Upsert customer identity
    let identity = await prisma.customerChannelIdentity.findUnique({
      where: {
        channelConnectionId_externalUserId: {
          channelConnectionId: connection.id,
          externalUserId: message.author.id,
        },
      },
    });

    if (!identity) {
      const profile = await prisma.customerProfile.create({
        data: {
          workspaceId: connection.workspaceId,
          displayName: message.author.globalName ?? message.author.username,
        },
      });

      identity = await prisma.customerChannelIdentity.create({
        data: {
          customerProfileId: profile.id,
          channelConnectionId: connection.id,
          externalUserId: message.author.id,
          username: message.author.username,
          displayName: message.author.globalName ?? message.author.username,
        },
      });
    }

    // Check if this message is inside a thread we already track
    const threadId = message.channel.isThread() ? message.channelId : null;

    let conversation = threadId
      ? await prisma.conversation.findFirst({
          where: {
            workspaceId: connection.workspaceId,
            customerProfileId: identity.customerProfileId,
            externalThreadId: threadId,
            status: { notIn: ["CLOSED"] },
          },
        })
      : null;

    if (!conversation) {
      conversation = await prisma.conversation.findFirst({
        where: {
          workspaceId: connection.workspaceId,
          customerProfileId: identity.customerProfileId,
          primaryChannelType: "DISCORD",
          status: { notIn: ["CLOSED"] },
        },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      });
    }

    const now = new Date();

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          workspaceId: connection.workspaceId,
          customerProfileId: identity.customerProfileId,
          primaryChannelType: "DISCORD",
          status: "NEW",
          subject: message.content.slice(0, 100),
          externalThreadId: threadId,
          lastMessageAt: now,
          lastInboundAt: now,
        },
      });
    } else {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastInboundAt: now, status: "WAITING_REVIEW" },
      });
    }

    // Store the inbound message
    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        channelConnectionId: connection.id,
        direction: "INBOUND",
        senderKind: "CUSTOMER",
        externalMessageId: message.id,
        body: message.content,
        rawPayloadJson: JSON.parse(JSON.stringify({
          authorId: message.author.id,
          username: message.author.username,
          channelId: message.channelId,
          guildId: message.guildId,
        })),
        sentAt: message.createdAt,
      },
    });

    console.log(
      `[discord-bot] Ingested message from ${message.author.username} in #${message.channel.isTextBased() ? ("name" in message.channel ? message.channel.name : channelId) : channelId} → conversation ${conversation.id}`
    );
  });

  client.login(botToken).catch((err) => {
    console.error("[discord-bot] Failed to login:", err);
  });
}
