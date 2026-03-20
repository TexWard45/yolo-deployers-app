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
  // Show what we have
  const conversations = await prisma.conversation.findMany({
    include: {
      customerProfile: true,
      messages: true,
      drafts: true,
    },
  });

  console.log(`Found ${conversations.length} conversations to clean up:\n`);
  for (const c of conversations) {
    console.log(`  ${c.id} | ${c.customerProfile.displayName} | ${c.messages.length} msgs | ${c.drafts.length} drafts`);
  }

  // Delete in order: drafts → messages → conversations → identities → profiles
  // Also remove the old test channel connection

  // 1. Delete all reply drafts
  const deletedDrafts = await prisma.replyDraft.deleteMany({});
  console.log(`\nDeleted ${deletedDrafts.count} reply drafts`);

  // 2. Delete all conversation messages
  const deletedMessages = await prisma.conversationMessage.deleteMany({});
  console.log(`Deleted ${deletedMessages.count} conversation messages`);

  // 3. Delete all conversations
  const deletedConvos = await prisma.conversation.deleteMany({});
  console.log(`Deleted ${deletedConvos.count} conversations`);

  // 4. Delete all customer channel identities
  const deletedIdentities = await prisma.customerChannelIdentity.deleteMany({});
  console.log(`Deleted ${deletedIdentities.count} customer channel identities`);

  // 5. Delete all customer profiles
  const deletedProfiles = await prisma.customerProfile.deleteMany({});
  console.log(`Deleted ${deletedProfiles.count} customer profiles`);

  // 6. Delete old/test channel connections that don't match the "support"/"company" naming
  const connections = await prisma.channelConnection.findMany({});
  console.log(`\nChannel connections:`);
  for (const conn of connections) {
    console.log(`  ${conn.id} | ${conn.name} | ${conn.type} | ${conn.status}`);
  }
  const deletedConnections = await prisma.channelConnection.deleteMany({});
  console.log(`Deleted ${deletedConnections.count} channel connections (will re-seed)`);

  console.log("\nCleanup complete. Run seed script to re-create proper channel connection.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
