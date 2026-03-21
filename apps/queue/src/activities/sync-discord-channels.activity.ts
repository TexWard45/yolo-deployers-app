import { prisma } from "@shared/database";
import { DiscordChannelConfigSchema } from "@shared/types";
import type { IngestSupportMessageInput } from "@shared/types";
import { queueEnv } from "@shared/env/queue";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const BACKFILL_LIMIT = 100;

interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = GUILD_TEXT
}

interface DiscordMessage {
  id: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  channel_id: string;
  guild_id?: string | null;
  message_reference?: {
    message_id?: string;
  } | null;
  mentions: Array<{
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  }>;
  attachments: Array<{
    url: string;
    filename: string;
    content_type?: string | null;
  }>;
}

async function discordFetch<T>(path: string): Promise<T> {
  const token = queueEnv.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN not set");

  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord API ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Activity 1: Discover text channels matching the name filter in the guild,
 * then update the connection's configJson with the new channel IDs.
 * Returns the list of discovered channels and which ones are newly added.
 */
export async function discoverAndUpdateChannelsActivity(params: {
  channelConnectionId: string;
  nameFilter: string;
}): Promise<{
  discovered: Array<{ id: string; name: string }>;
  addedIds: string[];
  allChannelIds: string[];
}> {
  const connection = await prisma.channelConnection.findUniqueOrThrow({
    where: { id: params.channelConnectionId },
  });

  if (!connection.externalAccountId) {
    throw new Error("Connection has no externalAccountId (guild ID)");
  }

  const guildId = connection.externalAccountId;

  // Get existing channel IDs from config
  const parsed = DiscordChannelConfigSchema.safeParse(connection.configJson);
  const existingChannelIds = parsed.success ? parsed.data.channelIds : [];

  // Fetch all guild channels from Discord API
  const channels = await discordFetch<DiscordChannel[]>(
    `/guilds/${guildId}/channels`,
  );

  // type 0 = GUILD_TEXT
  const textChannels = channels.filter((ch) => ch.type === 0);

  const filter = params.nameFilter.toLowerCase();
  const matching = filter
    ? textChannels.filter((ch) => ch.name.toLowerCase().includes(filter))
    : textChannels;

  const discovered = matching.map((ch) => ({ id: ch.id, name: ch.name }));

  const existingSet = new Set(existingChannelIds);
  const addedIds = discovered
    .filter((ch) => !existingSet.has(ch.id))
    .map((ch) => ch.id);

  // Merge: existing + newly discovered
  const allChannelIds = [...new Set([...existingChannelIds, ...discovered.map((ch) => ch.id)])];

  // Update the connection config (write via REST)
  const url = `${queueEnv.WEB_APP_URL}/api/rest/channel-connection/${params.channelConnectionId}/update-channels`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelIds: allChannelIds }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Update channels failed (${res.status}): ${body}`);
  }

  console.log(
    `[sync-discord] Discovered ${discovered.length} channels (${addedIds.length} new) for connection ${params.channelConnectionId}`,
  );

  return { discovered, addedIds, allChannelIds };
}

/**
 * Activity 2: Backfill messages from the specified channels via Discord REST API
 * and ingest them through the web app's intake endpoint.
 */
export async function backfillNewChannelsActivity(params: {
  channelConnectionId: string;
  channelIds: string[];
}): Promise<number> {
  let totalIngested = 0;

  for (const channelId of params.channelIds) {
    let messages: DiscordMessage[];
    try {
      messages = await discordFetch<DiscordMessage[]>(
        `/channels/${channelId}/messages?limit=${BACKFILL_LIMIT}`,
      );
    } catch (err) {
      console.warn(`[sync-discord] Failed to fetch messages from channel ${channelId}:`, err);
      continue;
    }

    // Sort oldest first
    const sorted = messages
      .filter((m) => !m.author.bot)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

    for (const msg of sorted) {
      const input: IngestSupportMessageInput = {
        channelConnectionId: params.channelConnectionId,
        externalMessageId: msg.id,
        externalUserId: msg.author.id,
        username: msg.author.username,
        displayName: msg.author.global_name ?? msg.author.username,
        body: msg.content,
        timestamp: msg.timestamp,
        rawPayload: {
          originalContent: msg.content,
          authorId: msg.author.id,
          username: msg.author.username,
          channelId: msg.channel_id,
          guildId: msg.guild_id,
          mentions: Object.fromEntries(
            msg.mentions.map((u) => [
              u.global_name ?? u.username,
              {
                avatarUrl: u.avatar
                  ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=32`
                  : null,
              },
            ]),
          ),
          attachments: msg.attachments
            .filter((a) => a.content_type?.startsWith("image/"))
            .map((a) => ({
              url: a.url,
              name: a.filename,
              contentType: a.content_type,
            })),
        },
        externalThreadId: null,
        inReplyToExternalMessageId: msg.message_reference?.message_id ?? null,
      };

      const url = `${queueEnv.WEB_APP_URL}/api/rest/intake/ingest-from-channel`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (res.ok) {
        totalIngested++;
      }
    }
  }

  console.log(
    `[sync-discord] Backfilled ${totalIngested} messages from ${params.channelIds.length} channels`,
  );

  return totalIngested;
}
