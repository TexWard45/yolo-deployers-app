import { prisma } from "@shared/database";

async function main() {
  console.log("=== Recent Conversation Messages (last 10) ===");
  const messages = await prisma.conversationMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      conversation: true,
    },
  });

  for (const msg of messages) {
    console.log(`\n--- Message ${msg.id} ---`);
    console.log(`  Direction: ${msg.direction}`);
    console.log(`  SenderKind: ${msg.senderKind}`);
    console.log(`  Body: ${msg.body}`);
    console.log(`  ExternalMessageId: ${msg.externalMessageId}`);
    console.log(`  ConversationId: ${msg.conversationId}`);
    console.log(`  Conversation Status: ${msg.conversation.status}`);
    console.log(`  Created: ${msg.createdAt}`);
  }

  console.log(`\n=== Total messages: ${messages.length} ===`);

  console.log("\n=== Recent Conversations ===");
  const convos = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 5,
  });

  for (const c of convos) {
    console.log(`\n--- Conversation ${c.id} ---`);
    console.log(`  Status: ${c.status}`);
    console.log(`  Subject: ${c.subject}`);
    console.log(`  Channel: ${c.primaryChannelType}`);
    console.log(`  LastMessage: ${c.lastMessageAt}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
