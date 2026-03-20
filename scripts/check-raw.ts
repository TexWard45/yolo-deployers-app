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
  const msgs = await prisma.conversationMessage.findMany({
    where: { direction: "INBOUND" },
  });
  for (const m of msgs) {
    console.log("ID:", m.id);
    console.log("externalMessageId:", m.externalMessageId);
    console.log("channelConnectionId:", m.channelConnectionId);
    console.log("rawPayloadJson:", JSON.stringify(m.rawPayloadJson, null, 2));
    console.log("---");
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
