import { PrismaClient } from "../packages/types/src/prisma-generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find the latest open conversation
  const conversation = await prisma.conversation.findFirst({
    where: { status: { in: ["OPEN", "PENDING"] } },
    include: { customerProfile: true },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
  });

  if (!conversation) {
    console.log("No open conversations found");
    return;
  }

  // Get the first inbound message to find the Discord channel/message
  const firstInbound = await prisma.conversationMessage.findFirst({
    where: {
      conversationId: conversation.id,
      direction: "INBOUND",
    },
    orderBy: { sentAt: "asc" },
  });

  if (!firstInbound?.rawPayloadJson) {
    console.log("No inbound message with Discord metadata found");
    return;
  }

  const metadata = firstInbound.rawPayloadJson as Record<string, string>;
  const channelId = metadata.channelId ?? metadata.externalChannelId;
  const originalMessageId = firstInbound.externalMessageId;

  console.log(`Conversation: ${conversation.id}`);
  console.log(`Customer: ${conversation.customerProfile.displayName}`);
  console.log(`Discord channel: ${channelId}`);
  console.log(`Original message: ${originalMessageId}`);

  // Connect Discord bot
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await client.login(process.env.DISCORD_BOT_TOKEN!);
  await new Promise<void>((resolve) => client.once("ready", () => resolve()));
  console.log(`\nBot logged in as ${client.user?.tag}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    console.log("Channel not found or not text-based");
    client.destroy();
    return;
  }

  const replyBody = "Hi! Thanks for reaching out. I see you mentioned an issue — could you share more details about what you're experiencing? We're here to help! 🚀";

  let threadId = conversation.externalThreadId;
  let sentMessage;

  if (threadId) {
    // Post into existing thread
    console.log(`\nPosting into existing thread: ${threadId}`);
    const thread = await client.channels.fetch(threadId);
    if (thread?.isTextBased() && "send" in thread) {
      sentMessage = await thread.send(replyBody);
    }
  } else if (originalMessageId && "messages" in channel) {
    // Create a thread on the original message
    console.log(`\nCreating thread on original message: ${originalMessageId}`);
    try {
      const originalMsg = await channel.messages.fetch(originalMessageId);
      const thread = await originalMsg.startThread({
        name: `Support: ${conversation.customerProfile.displayName ?? "Customer"}`,
      });
      threadId = thread.id;
      sentMessage = await thread.send(replyBody);

      // Save thread ID back to conversation
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { externalThreadId: threadId },
      });
      console.log(`Thread created: ${threadId}`);
    } catch (err) {
      // Fallback: reply directly in channel
      console.log(`Thread creation failed, replying in channel:`, err);
      sentMessage = await channel.send({
        content: replyBody,
        reply: { messageReference: originalMessageId },
      });
    }
  } else {
    // Direct channel reply
    sentMessage = await channel.send(replyBody);
  }

  if (sentMessage) {
    // Store outbound message in DB
    const now = new Date();
    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        senderKind: "AGENT",
        externalMessageId: sentMessage.id,
        body: replyBody,
        sentAt: now,
        deliveryStatus: "delivered",
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastOutboundAt: now,
        status: "PENDING",
      },
    });

    console.log(`\nReply sent and saved!`);
    console.log(`Discord message ID: ${sentMessage.id}`);
    console.log(`Thread ID: ${threadId ?? "none (direct reply)"}`);
  }

  client.destroy();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
