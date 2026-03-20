import { Client, GatewayIntentBits, Events } from "discord.js";
import { prisma } from "@shared/database";
import type { DiscordChannelConfig, IngestSupportMessageInput } from "@shared/types";
import { DiscordChannelConfigSchema } from "@shared/types";
import { getTemporalClient } from "./temporal-client.js";
import { temporalConfig } from "./config.js";
import { workflowRegistry } from "./workflows/registry.js";

// ── Connection cache ──────────────────────────────────────────────
interface CachedConnection {
  id: string;
  externalAccountId: string | null;
  workspaceId: string;
  config: DiscordChannelConfig;
}

let connectionCache: CachedConnection[] = [];
let cacheLastRefreshed = 0;
const CACHE_TTL_MS = 60_000;

async function refreshConnectionCache(): Promise<void> {
  const now = Date.now();
  if (now - cacheLastRefreshed < CACHE_TTL_MS && connectionCache.length > 0) return;

  const connections = await prisma.channelConnection.findMany({
    where: { type: "DISCORD", status: "active" },
  });

  connectionCache = connections
    .map((c) => {
      const parsed = DiscordChannelConfigSchema.safeParse(c.configJson);
      if (!parsed.success) return null;
      return {
        id: c.id,
        externalAccountId: c.externalAccountId,
        workspaceId: c.workspaceId,
        config: parsed.data,
      };
    })
    .filter((c): c is CachedConnection => c !== null);

  cacheLastRefreshed = now;
  console.log(`[discord-bot] Refreshed connection cache: ${connectionCache.length} active connections`);
}

function findMatchingConnection(
  guildId: string | null,
  channelId: string,
  parentChannelId: string | null,
): CachedConnection | undefined {
  return connectionCache.find((conn) => {
    // Connection must match the guild
    if (conn.externalAccountId !== guildId) return false;
    // Channel or parent channel must be in the configured list
    return (
      conn.config.channelIds.includes(channelId) ||
      (parentChannelId !== null && conn.config.channelIds.includes(parentChannelId))
    );
  });
}

// ── Workflow handle cache (one long-running workflow per connection) ─
const workflowHandles = new Map<string, boolean>();

async function ensureWorkflowRunning(connectionId: string): Promise<void> {
  if (workflowHandles.has(connectionId)) return;

  const temporal = await getTemporalClient();
  const workflowId = `discord-ingest-${connectionId}`;

  try {
    const handle = temporal.workflow.getHandle(workflowId);
    await handle.describe();
    // Workflow already running
    workflowHandles.set(connectionId, true);
  } catch {
    // Workflow not found — start it
    await temporal.workflow.start(workflowRegistry.ingestSupportMessage, {
      args: [connectionId, 0],
      taskQueue: temporalConfig.taskQueue,
      workflowId,
    });
    workflowHandles.set(connectionId, true);
    console.log(`[discord-bot] Started ingest workflow for connection ${connectionId}`);
  }
}

async function signalWorkflow(
  connectionId: string,
  input: IngestSupportMessageInput,
): Promise<void> {
  const temporal = await getTemporalClient();
  const workflowId = `discord-ingest-${connectionId}`;

  await ensureWorkflowRunning(connectionId);

  const handle = temporal.workflow.getHandle(workflowId);
  await handle.signal("inboundMessage", input);
}

// ── Discord bot ───────────────────────────────────────────────────
export function startDiscordBot(botToken: string): void {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`[discord-bot] Logged in as ${c.user.tag}`);
    await refreshConnectionCache();
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    try {
      await refreshConnectionCache();

      const guildId = message.guildId;
      const channelId = message.channelId;
      const parentChannelId = message.channel.isThread()
        ? message.channel.parentId
        : null;

      const connection = findMatchingConnection(guildId, channelId, parentChannelId);
      if (!connection) return;

      const isThread = message.channel.isThread();
      const externalThreadId = isThread ? channelId : null;

      const input: IngestSupportMessageInput = {
        channelConnectionId: connection.id,
        externalMessageId: message.id,
        externalUserId: message.author.id,
        username: message.author.username,
        displayName: message.author.globalName ?? message.author.username,
        body: message.content,
        timestamp: message.createdAt.toISOString(),
        rawPayload: {
          authorId: message.author.id,
          username: message.author.username,
          channelId: message.channelId,
          guildId: message.guildId,
        },
        externalThreadId,
      };

      await signalWorkflow(connection.id, input);

      const channelName = "name" in message.channel ? (message.channel.name ?? channelId) : channelId;
      console.log(
        `[discord-bot] Signaled ingest workflow for message from ${message.author.username} in #${channelName}`,
      );
    } catch (err) {
      console.error("[discord-bot] Failed to process message:", err);
    }
  });

  client.login(botToken).catch((err) => {
    console.error("[discord-bot] Failed to login:", err);
  });
}
