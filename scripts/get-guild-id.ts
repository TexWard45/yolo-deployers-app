import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", (c) => {
  console.log(`Bot: ${c.user.tag}`);
  console.log(`\nGuilds (servers) the bot is in:`);
  for (const [id, guild] of c.guilds.cache) {
    console.log(`  ${id} — ${guild.name}`);
  }
  client.destroy();
});

client.login(process.env.DISCORD_BOT_TOKEN!);
