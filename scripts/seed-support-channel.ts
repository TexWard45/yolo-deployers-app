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
  // 1. Create or find workspace
  let workspace = await prisma.workspace.findUnique({
    where: { slug: "yolo-deployers" },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "Yolo Deployers",
        slug: "yolo-deployers",
      },
    });
    console.log("Created workspace:", workspace.id);
  } else {
    console.log("Workspace exists:", workspace.id);
  }

  // 2. Create or find admin user
  let user = await prisma.user.findUnique({
    where: { username: "admin" },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        username: "admin",
        email: "admin@yolo-deployers.com",
        password: "$2b$10$placeholder", // Set a real password via the app
        name: "Admin",
        isSystemAdmin: true,
      },
    });
    console.log("Created admin user:", user.id);
  } else {
    console.log("Admin user exists:", user.id);
  }

  // 3. Ensure user is workspace member
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  });

  if (!membership) {
    await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "OWNER",
      },
    });
    console.log("Added admin as workspace OWNER");
  }

  // 4. Create Discord channel connection
  // Bot only listens to channels with "support" or "company" in their name
  // externalAccountId stores the guild ID for matching
  const GUILD_ID = "1478163776506171588";

  const existing = await prisma.channelConnection.findFirst({
    where: {
      workspaceId: workspace.id,
      type: "DISCORD",
    },
  });

  if (!existing) {
    const connection = await prisma.channelConnection.create({
      data: {
        workspaceId: workspace.id,
        type: "DISCORD",
        name: "discord-support",
        status: "active",
        externalAccountId: GUILD_ID,
        configJson: {
          botToken: "stored-via-env",
          channelFilter: "Channels with 'support' or 'company' in name",
        },
      },
    });
    console.log("Created Discord channel connection:", connection.id);
  } else {
    console.log("Discord channel connection exists:", existing.id);
  }

  // 5. Create default AI agent config
  const agentConfig = await prisma.workspaceAgentConfig.findUnique({
    where: { workspaceId: workspace.id },
  });

  if (!agentConfig) {
    await prisma.workspaceAgentConfig.create({
      data: {
        workspaceId: workspace.id,
        enabled: true,
        autoDraftOnInbound: true,
        tone: "professional and friendly",
        systemPrompt:
          "You are a helpful support agent for Yolo Deployers. Answer questions about deployments, infrastructure, and product features.",
      },
    });
    console.log("Created default AI agent config");
  } else {
    console.log("AI agent config exists");
  }

  console.log("\nSeed complete! Discord channel #yolo-deployer-support is ready to receive messages.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
