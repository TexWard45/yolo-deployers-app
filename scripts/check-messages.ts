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
  const messages = await prisma.conversationMessage.findMany({
    include: { conversation: { include: { customerProfile: true } } },
    orderBy: { sentAt: "desc" },
    take: 10,
  });

  console.log(`\n=== ${messages.length} messages found ===\n`);
  for (const m of messages) {
    console.log(`[${m.direction}] ${m.senderKind} | ${m.conversation.customerProfile.displayName}`);
    console.log(`  Body: ${m.body}`);
    console.log(`  ConversationId: ${m.conversationId}`);
    console.log(`  SentAt: ${m.sentAt}`);
    console.log(`  DeliveryStatus: ${m.deliveryStatus}`);
    console.log();
  }

  const convos = await prisma.conversation.findMany({
    include: {
      customerProfile: true,
      _count: { select: { messages: true } },
    },
  });

  console.log(`=== ${convos.length} conversations ===\n`);
  for (const c of convos) {
    console.log(`  ${c.id} | ${c.status} | ${c.customerProfile.displayName} | ${c._count.messages} msgs | thread: ${c.externalThreadId ?? "none"}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
