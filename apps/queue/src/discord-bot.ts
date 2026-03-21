import {
  Client,
  ChannelType,
  GatewayIntentBits,
  Events,
  type TextChannel,
  type Message,
} from "discord.js";
import { prisma } from "@shared/database";
import type { DiscordChannelConfig, IngestSupportMessageInput } from "@shared/types";
import { DiscordChannelConfigSchema } from "@shared/types";
import { queueEnv } from "@shared/env/queue";

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

/**
 * For connections with outdated/missing configJson, auto-discover text
 * channels in the guild and update the DB record with channelIds.
 */
async function autoDiscoverChannels(
  discordClient: Client,
  connectionId: string,
  guildId: string,
): Promise<DiscordChannelConfig | null> {
  const guild = discordClient.guilds.cache.get(guildId)
    ?? await discordClient.guilds.fetch(guildId).catch(() => null);

  if (!guild) {
    console.warn(`[discord-bot] Guild ${guildId} not accessible — skipping auto-discover`);
    return null;
  }

  const channels = await guild.channels.fetch();
  const textChannelIds = channels
    .filter((ch): ch is TextChannel =>
      ch !== null && ch.type === ChannelType.GuildText,
    )
    .map((ch) => ch.id);

  if (textChannelIds.length === 0) {
    console.warn(`[discord-bot] No text channels found in guild ${guild.name}`);
    return null;
  }

  const config: DiscordChannelConfig = {
    channelIds: textChannelIds,
    listenToThreads: true,
  };

  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { configJson: config as Record<string, unknown> as never },
  });

  console.log(
    `[discord-bot] Auto-discovered ${textChannelIds.length} channels in guild "${guild.name}" for connection ${connectionId}`,
  );

  return config;
}

async function refreshConnectionCache(discordClient?: Client): Promise<void> {
  const now = Date.now();
  if (now - cacheLastRefreshed < CACHE_TTL_MS && connectionCache.length > 0) return;

  const connections = await prisma.channelConnection.findMany({
    where: { type: "DISCORD", status: "active" },
  });

  const result: CachedConnection[] = [];

  for (const c of connections) {
    let parsed = DiscordChannelConfigSchema.safeParse(c.configJson);

    // Auto-discover if configJson is missing/invalid and we have a Discord client
    if (!parsed.success && discordClient && c.externalAccountId) {
      const discovered = await autoDiscoverChannels(discordClient, c.id, c.externalAccountId);
      if (discovered) {
        parsed = DiscordChannelConfigSchema.safeParse(discovered);
      }
    }

    if (parsed.success) {
      result.push({
        id: c.id,
        externalAccountId: c.externalAccountId,
        workspaceId: c.workspaceId,
        config: parsed.data,
      });
    }
  }

  connectionCache = result;
  cacheLastRefreshed = now;
  console.log(`[discord-bot] Refreshed connection cache: ${connectionCache.length} active connections`);
}

function findMatchingConnection(
  guildId: string | null,
  channelId: string,
  parentChannelId: string | null,
): CachedConnection | undefined {
  return connectionCache.find((conn) => {
    if (conn.externalAccountId !== guildId) return false;
    return (
      conn.config.channelIds.includes(channelId) ||
      (parentChannelId !== null && conn.config.channelIds.includes(parentChannelId))
    );
  });
}

// ── REST ingestion ──────────────────────────────────────────────────

/**
 * Send a message to the web app REST endpoint for ingestion.
 * Replaces the old Temporal workflow signal approach.
 */
async function ingestViaRest(input: IngestSupportMessageInput): Promise<void> {
  const url = `${queueEnv.WEB_APP_URL}/api/rest/intake/ingest-from-channel`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ingestion failed (${response.status}): ${body}`);
  }
}

// ── Backfill: fetch recent messages on startup ────────────────────
const BACKFILL_LIMIT = 100;

function discordMessageToInput(
  connectionId: string,
  message: Message,
): IngestSupportMessageInput {
  return {
    channelConnectionId: connectionId,
    externalMessageId: message.id,
    externalUserId: message.author.id,
    username: message.author.username,
    displayName: message.author.globalName ?? message.author.username,
    body: message.cleanContent,
    timestamp: message.createdAt.toISOString(),
    rawPayload: {
      originalContent: message.content,
      authorId: message.author.id,
      username: message.author.username,
      channelId: message.channelId,
      guildId: message.guildId,
      mentions: Object.fromEntries(
        message.mentions.users.map((user) => {
          const member = message.mentions.members?.get(user.id);
          const displayName = member?.displayName ?? user.globalName ?? user.username;
          return [displayName, { avatarUrl: user.displayAvatarURL({ size: 32 }) }];
        }),
      ),
    },
    externalThreadId: message.channel.isThread() ? message.channelId : null,
    inReplyToExternalMessageId: message.reference?.messageId ?? null,
  };
}

async function backfillChannel(
  discordClient: Client,
  conn: CachedConnection,
  channelId: string,
): Promise<number> {
  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return 0;

  const messages = await channel.messages.fetch({ limit: BACKFILL_LIMIT });
  const sorted = [...messages.values()]
    .filter((m) => !m.author.bot)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let ingested = 0;

  for (const msg of sorted) {
    // Skip if already in DB (idempotency)
    const existing = await prisma.threadMessage.findFirst({
      where: {
        externalMessageId: msg.id,
        thread: {
          workspaceId: conn.workspaceId,
        },
      },
    });
    if (existing) continue;

    const input = discordMessageToInput(conn.id, msg);
    await ingestViaRest(input);
    ingested++;
  }

  return ingested;
}

async function backfillConnection(
  discordClient: Client,
  conn: CachedConnection,
): Promise<void> {
  let total = 0;

  for (const channelId of conn.config.channelIds) {
    const count = await backfillChannel(discordClient, conn, channelId);
    total += count;
  }

  if (total > 0) {
    console.log(`[discord-bot] Backfilled ${total} messages for connection ${conn.id}`);
  } else {
    console.log(`[discord-bot] No new messages to backfill for connection ${conn.id}`);
  }
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

    // Refresh cache with auto-discover (passes Discord client for guild access)
    await refreshConnectionCache(client);

    // Backfill recent messages for every active connection
    for (const conn of connectionCache) {
      try {
        await backfillConnection(client, conn);
      } catch (err) {
        console.error(`[discord-bot] Startup failed for connection ${conn.id}:`, err);
      }
    }

    if (connectionCache.length > 0) {
      console.log(`[discord-bot] Startup complete: ${connectionCache.length} connections active`);
    } else {
      console.warn("[discord-bot] No active Discord connections found");
    }
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

      const input = discordMessageToInput(connection.id, message);
      await ingestViaRest(input);

      const channelName = "name" in message.channel ? (message.channel.name ?? channelId) : channelId;
      console.log(
        `[discord-bot] Ingested message from ${message.author.username} in #${channelName}`,
      );
    } catch (err) {
      console.error("[discord-bot] Failed to process message:", err);
    }
  });

  client.login(botToken).catch((err) => {
    console.error("[discord-bot] Failed to login:", err);
  });
}
