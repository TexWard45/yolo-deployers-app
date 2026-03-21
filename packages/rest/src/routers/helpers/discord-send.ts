const DISCORD_API = "https://discord.com/api/v10";

interface SendDiscordReplyOptions {
  channelId: string;
  content: string;
  replyToMessageId?: string;
}

export async function sendDiscordReply(options: SendDiscordReplyOptions): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("[discord-send] DISCORD_BOT_TOKEN not set, skipping Discord reply");
    return;
  }

  const body: Record<string, unknown> = {
    content: options.content,
  };

  if (options.replyToMessageId) {
    body.message_reference = {
      message_id: options.replyToMessageId,
    };
  }

  const res = await fetch(`${DISCORD_API}/channels/${options.channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API error (${res.status}): ${text}`);
  }
}
