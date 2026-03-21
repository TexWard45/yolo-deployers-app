# Engineering Spec: Discord Mention Resolution

## 1. Job to Be Done

- **Who:** Support agents using the inbox UI to read Discord-sourced messages.
- **What:** When a Discord message contains a user mention (`<@363504204549193739>`), a role mention (`<@&role_id>`), or a channel mention (`<#channel_id>`), the inbox UI should display the resolved human-readable name (e.g. `@DrGuru`, `@Admin`, `#general`) instead of raw snowflake IDs.
- **Why:** Raw Discord IDs are meaningless to support agents. They can't tell who is being referenced, making conversations harder to follow.
- **Success criteria:**
  1. User mentions render as `@DisplayName` with distinct styling (e.g. colored pill/badge).
  2. Role mentions render as `@RoleName`.
  3. Channel mentions render as `#ChannelName`.
  4. Unknown/unresolvable IDs degrade gracefully to `@unknown-user` / `@unknown-role` / `#unknown-channel` instead of raw `<@...>`.
  5. No performance regression — resolution happens at ingestion time, not per-render.

---

## 2. Proposed Flow / Architecture

### Approach: Resolve at ingestion time, store resolved text

The Discord bot (`apps/queue/src/discord-bot.ts`) already has access to the guild via `discord.js`. Discord.js `Message` objects carry a `.mentions` collection with resolved user/role/channel objects. We use this data to replace raw mention syntax in the message body **before** sending it to the web app for storage.

This is superior to client-side resolution because:
- No extra API calls on every page load.
- Works for historical messages (backfill resolves too).
- The web app doesn't need Discord API access.

### Data Model Changes

**None.** We store the resolved text directly in `ThreadMessage.body`. The raw Discord content is already preserved in `ThreadMessage.metadata.rawPayload` — we add the original `content` there for auditability.

### Flow

```
1. Discord bot receives message via Events.MessageCreate
2. discordMessageToInput() is called
3. NEW: resolveDiscordMentions(message) replaces mention syntax with display names:
   - <@123456> → @DisplayName  (from message.mentions.users)
   - <@&789>   → @RoleName     (from message.mentions.roles)
   - <#456>    → #ChannelName  (from message.mentions.channels)
4. Resolved body is set on input.body
5. Original raw content preserved in rawPayload.originalContent
6. Message sent to web app via POST /api/rest/intake/ingest-from-channel
7. Stored in DB with clean, human-readable body
```

### Frontend Changes

Replace the plain text `<p>{message.body}</p>` in `MessageTimeline.tsx` with a component that styles inline mentions. Since the body now contains `@DisplayName` patterns instead of raw IDs, we parse `@word` tokens and render them with distinct styling (a lightweight regex match + styled `<span>`).

**Approach:** A simple `renderMessageBody(body: string)` function that splits on a mention pattern and wraps matches in a styled span. This is purely cosmetic — the data is already resolved.

### Key Files to Modify

| File | Change |
|------|--------|
| `apps/queue/src/discord-bot.ts` | Add `resolveDiscordMentions()`, update `discordMessageToInput()` to use it, preserve raw content in rawPayload |
| `apps/web/src/components/inbox/MessageTimeline.tsx` | Replace plain text body with mention-aware rendering |

### Dependencies

- **None new.** `discord.js` already provides resolved mention data on `Message` objects via the `GuildMembers` intent... BUT we need to check if `GatewayIntentBits.GuildMembers` is enabled. Currently only `Guilds`, `GuildMessages`, `MessageContent` are set. The `message.mentions.users` collection is populated from the message payload itself (no extra intent needed for users mentioned in the message). Roles and channels are similarly available. So **no new intents required** for basic mention resolution from message data.

### Edge Cases

- **Mentions of users not in the guild cache:** `message.mentions.users` is populated from the API payload regardless of cache — this works.
- **Nickname vs username:** Use `member.displayName` (guild nickname) if available via `message.mentions.members`, fall back to `user.globalName ?? user.username`.
- **Backfill:** The existing `backfillChannel()` function already uses `discordMessageToInput()`, so backfilled messages will also get resolved mentions automatically.
- **Already-ingested messages:** Old messages in the DB retain raw IDs. A one-time backfill migration could be done later but is out of scope for v1.

---

## 3. Task Checklist

### Backend / Queue

- [ ] **Add `resolveDiscordMentions()` to discord-bot.ts** — Function that takes a Discord.js `Message` and returns the body with all `<@id>`, `<@&id>`, `<#id>` patterns replaced with `@DisplayName`, `@RoleName`, `#ChannelName`. Use `message.mentions.users`, `message.mentions.roles`, `message.mentions.channels` for lookups. Fall back to `@unknown-user` etc. for unresolved IDs.

- [ ] **Update `discordMessageToInput()` to call resolver** — Replace `body: message.content` with `body: resolveDiscordMentions(message)`. Add `originalContent: message.content` to `rawPayload` so the raw Discord format is preserved for debugging/audit.

### Frontend / UI

- [ ] **Add mention-aware body rendering in `MessageTimeline.tsx`** — Replace `<p>{message.body}</p>` with a function that detects `@SomeName` patterns and wraps them in a styled `<span>` (e.g. `bg-blue-100 text-blue-800 rounded px-1 font-medium text-xs`). Keep it simple — regex split, no complex parser. Channel mentions (`#name`) get similar but distinct styling.

### Testing / Validation

- [ ] **Manual E2E test** — Send a Discord message that @mentions a user, a role, and a channel. Verify the inbox UI shows resolved names with styling, not raw IDs.

- [ ] **Verify backfill works** — Delete a test message from DB, restart the queue worker, confirm the backfilled message has resolved mentions.

- [ ] **Verify raw content preserved** — Check `ThreadMessage.metadata.rawPayload.originalContent` contains the original Discord content with `<@...>` syntax.

---

## 4. Testing Checklist

- [ ] **Happy path:** Discord message with `<@userId>` mention displays as `@Username` with styled badge in inbox UI
- [ ] **Multiple mentions:** Message with 3+ different user mentions resolves all of them
- [ ] **Role mention:** `<@&roleId>` displays as `@RoleName`
- [ ] **Channel mention:** `<#channelId>` displays as `#ChannelName`
- [ ] **Unknown user:** Mention of a user not resolvable shows `@unknown-user` instead of raw ID
- [ ] **No mentions:** Messages without mentions render identically to before (no regression)
- [ ] **Backfill:** Messages fetched during startup backfill also have resolved mentions
- [ ] **Raw content audit:** `rawPayload.originalContent` in DB metadata contains original `<@...>` format
- [ ] **Type safety:** `npm run type-check` passes
- [ ] **Build:** `npm run build --workspace @app/queue` succeeds
- [ ] **Build:** `npm run build --workspace @app/web` succeeds
