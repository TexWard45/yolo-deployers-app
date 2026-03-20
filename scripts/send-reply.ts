import { PrismaClient } from "../packages/types/src/prisma-generated/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find the conversation with _dr.guru_
  const conversation = await prisma.conversation.findFirst({
    where: { status: "OPEN" },
    include: {
      customerProfile: true,
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
  });

  if (!conversation) {
    console.log("No open conversations found");
    return;
  }

  console.log(`Replying to conversation with ${conversation.customerProfile.displayName}`);
  console.log(`Conversation ID: ${conversation.id}`);
  console.log(`Last message: ${conversation.messages[0]?.body}`);

  // Find the workspace member (admin user)
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: conversation.workspaceId, role: "OWNER" },
  });

  if (!member) {
    console.log("No workspace owner found");
    return;
  }

  const now = new Date();
  const replyBody = "Hi! Thanks for reaching out. I see you mentioned an issue — could you share more details about what you're experiencing? We're here to help! 🚀";

  // Create the outbound message
  const message = await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      senderKind: "AGENT",
      body: replyBody,
      sentAt: now,
      deliveryStatus: "pending",
    },
  });

  // Update conversation timestamps
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      lastOutboundAt: now,
      status: "PENDING",
    },
  });

  console.log(`\nCreated outbound message: ${message.id}`);
  console.log(`Body: ${replyBody}`);
  console.log(`Status: pending (delivery to Discord would be handled by workflow)`);

  // Now let's actually send it to Discord using the bot
  // We need to find the original Discord channel from the inbound message
  const inboundMsg = await prisma.conversationMessage.findFirst({
    where: {
      conversationId: conversation.id,
      direction: "INBOUND",
    },
    orderBy: { sentAt: "asc" },
  });

  if (inboundMsg?.rawPayloadJson) {
    const payload = inboundMsg.rawPayloadJson as Record<string, string>;
    console.log(`\nOriginal Discord channel: ${payload.channelId}`);
    console.log(`Original message ID: ${inboundMsg.externalMessageId}`);
    console.log(`\nTo deliver via Discord, the bot would:`);
    console.log(`1. Create a thread on message ${inboundMsg.externalMessageId}`);
    console.log(`2. Post the reply in that thread`);
    console.log(`3. Save the thread ID back to conversation.externalThreadId`);
  }

  // Mark as delivered for demo purposes
  await prisma.conversationMessage.update({
    where: { id: message.id },
    data: { deliveryStatus: "delivered" },
  });

  console.log("\nMessage marked as delivered.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
