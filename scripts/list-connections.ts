import { prisma } from "@shared/database";

async function main() {
  console.log("=== All Channel Connections ===");
  const connections = await prisma.channelConnection.findMany();

  if (connections.length === 0) {
    console.log("No channel connections found.");
    console.log("\nYou need to create one. Run: npx tsx scripts/create-discord-connection.ts");
  }

  for (const c of connections) {
    console.log(`\n--- Connection ${c.id} ---`);
    console.log(`  Type: ${c.type}`);
    console.log(`  Name: ${c.name}`);
    console.log(`  Status: ${c.status}`);
    console.log(`  ExternalAccountId (guildId): ${c.externalAccountId}`);
    console.log(`  ConfigJson: ${JSON.stringify(c.configJson)}`);
    console.log(`  WorkspaceId: ${c.workspaceId}`);
  }

  console.log("\n=== All Workspaces ===");
  const workspaces = await prisma.workspace.findMany();
  for (const w of workspaces) {
    console.log(`  ${w.id} — ${w.name} (${w.slug})`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
