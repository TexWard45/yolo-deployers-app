import { prisma } from "@shared/database";

const GUILD_ID = "1478163776506171588";

export async function seedDiscordConnection(): Promise<void> {
  // 1. Ensure workspace exists
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
    console.log("[seed] Created workspace:", workspace.id);
  }

  // 2. Ensure admin user exists
  let user = await prisma.user.findUnique({
    where: { username: "admin" },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        username: "admin",
        email: "admin@yolo-deployers.com",
        password: "$2b$10$placeholder",
        name: "Admin",
        isSystemAdmin: true,
      },
    });
    console.log("[seed] Created admin user:", user.id);
  }

  // 3. Ensure workspace membership
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
    console.log("[seed] Added admin as workspace OWNER");
  }

  // 4. Ensure Discord channel connection
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
    console.log("[seed] Created Discord channel connection:", connection.id);
  }

  // 5. Ensure AI agent config
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
    console.log("[seed] Created default AI agent config");
  }

  console.log("[seed] Discord connection setup complete");
}
