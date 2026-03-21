# Engineering Spec: Unify Support Data Model

## 1. Job to Be Done

- **Who:** Support agents using the inbox UI + the Discord bot ingestion pipeline.
- **What:** Eliminate the parallel `Conversation`/`ConversationMessage`/`CustomerProfile`/`CustomerChannelIdentity` model. Consolidate everything onto `SupportThread` + `ThreadMessage` + `Customer` as the single source of truth. Rewire `ReplyDraft`, webhooks, and the agent router. Enhance the inbox UI with visual sub-thread grouping.
- **Why:** Two disconnected data models exist side by side. The Discord bot ingestion writes to `SupportThread` + `ThreadMessage` (the working path). The legacy Discord/chat webhooks and `agentRouter` write to `Conversation` + `ConversationMessage` (dead/out-of-sync tables). `ReplyDraft` is FK'd to `Conversation`, so AI drafts are unreachable from the thread-based UI. This causes dead code, broken features, and confusion about which model is canonical.
- **Success criteria:**
  - Zero references to `Conversation`, `ConversationMessage`, `CustomerProfile`, or `CustomerChannelIdentity` in source code or schema.
  - All ingestion paths write to `SupportThread` + `ThreadMessage`.
  - `ReplyDraft` FK points to `SupportThread`.
  - `agent.generateDraft/approveDraft/dismissDraft` work end-to-end against `SupportThread`.
  - Inbox UI at `/inbox/[threadId]` shows messages in visual sub-thread blocks with segment-pinned reply composer.
  - `npm run type-check` and `npm run build` pass for all workspaces.

---

## 2. Proposed Flow / Architecture

### 2.1 Single Source of Truth (after refactor)

```
Customer (who)
  workspaceId + source + externalCustomerId  (unique identity)
  displayName, avatarUrl, email

  └── SupportThread[] (one per issue)
        title, status, issueFingerprint, summary
        source (DISCORD | MANUAL | API)
        externalThreadId
        assignedToId

        ├── ThreadMessage[] (flat list — visual sub-threads computed client-side)
        │     direction (INBOUND | OUTBOUND | SYSTEM)
        │     body, externalMessageId
        │     inReplyToExternalMessageId   ← drives visual grouping
        │     senderExternalId, messageFingerprint

        └── ReplyDraft[] (AI drafts)
              threadId (FK → SupportThread)
              basedOnMessageId (FK → ThreadMessage)
              status (GENERATED | APPROVED | SENT | DISMISSED)

ChannelConnection (channel config, kept as-is)
WorkspaceAgentConfig (AI agent settings, kept as-is)
```

Visual sub-threads ("Thread 1", "Thread 2") are **not a DB model**. They are computed at render time by `groupMessagesIntoSegments()` from `inReplyToExternalMessageId` chains on flat `ThreadMessage` rows.

### 2.2 What Gets Deleted

| Model | Why it exists | Why it's safe to delete |
|---|---|---|
| `Conversation` | Legacy issue container | Inbox UI reads `SupportThread`. Ingestion writes to `SupportThread`. `Conversation` is either empty or out of sync. |
| `ConversationMessage` | Legacy message storage | Same — all working messages are in `ThreadMessage`. |
| `CustomerProfile` | Legacy customer identity | Replaced by `Customer` (already has `workspaceId + source + externalCustomerId` unique). |
| `CustomerChannelIdentity` | Maps customer to channel | Unnecessary — `Customer.externalCustomerId` serves the same purpose for lookup. |

Also deleted:
- `conversationRouter` (entire file)
- Conversation-related Zod schemas (6 schemas + types)
- `conversation` registration in `appRouter`

### 2.3 What Gets Modified

**Schema (`support.schema.prisma`):**

`ReplyDraft`:
```prisma
model ReplyDraft {
  // ... existing fields unchanged ...

  thread           SupportThread    @relation(fields: [threadId], references: [id], onDelete: Cascade)
  threadId         String           // was: conversationId → Conversation
  basedOnMessage   ThreadMessage?   @relation(fields: [basedOnMessageId], references: [id])
  basedOnMessageId String?          // was: → ConversationMessage
  createdByUser    User?            @relation(fields: [createdByUserId], references: [id])
  createdByUserId  String?
}
```

`SupportThread` — add: `drafts ReplyDraft[]`
`ThreadMessage` — add: `basedOnDrafts ReplyDraft[]`
`ChannelConnection` — remove: `customerIdentities`, `messages` relations
`Workspace` — remove: `customerProfiles`, `conversations` relations
`User` — remove: `assignedConversations` relation

**Schema (`schema.prisma`):**
Same `Workspace` and `User` relation removals (the generated schema combines both files).

**Zod schemas (`packages/types/src/schemas/index.ts`):**
- Delete: `ListConversationsSchema`, `UpdateConversationStatusSchema`, `AssignConversationSchema`, `MergeCustomerIdentitySchema`, `ListMessagesByConversationSchema`, `SendConversationReplySchema` + all their types
- Modify: `GenerateReplyDraftSchema` — rename `conversationId` → `threadId`

**Agent router (`packages/rest/src/routers/agent.ts`):**
- `generateDraft`: query `supportThread` + `ThreadMessage` instead of `conversation` + `ConversationMessage`. Create `ReplyDraft` with `threadId`.
- `approveDraft`: include `thread` instead of `conversation` for workspace check.
- `dismissDraft`: same as approveDraft.

**Thread router (`packages/rest/src/routers/thread.ts`):**
- `getById`: include `drafts` (where status "GENERATED", latest 1) in response.

**Discord webhook (`apps/web/src/app/api/webhooks/discord/route.ts`):**
- Currently: manually creates `CustomerProfile` → `CustomerChannelIdentity` → `Conversation` → `ConversationMessage` (~180 lines of direct Prisma calls)
- After: call `createCaller(createTRPCContext()).intake.ingestFromChannel(...)` with the Discord payload mapped to `IngestSupportMessageInput` (~30 lines)

**Chat webhook (`apps/web/src/app/api/webhooks/chat/route.ts`):**
- Same rewrite as Discord webhook, using `performIngestion` path.

**Discord bot backfill (`apps/queue/src/discord-bot.ts`):**
- Line 185: dedup check queries `prisma.conversationMessage` (wrong table). Change to `prisma.threadMessage` matching on `externalMessageId`.

### 2.4 Frontend Changes

No new pages. The inbox already uses `SupportThread`:
- `/inbox` → kanban via `thread.listByWorkspace`
- `/inbox/[threadId]` → detail via `thread.getById`

**`message-segments.ts` — enhance grouping:**

Current logic:
1. Group by `inReplyToExternalMessageId` chain
2. Every new INBOUND without reply context → new segment

Add third rule:
3. Time-window + same-speaker fallback — consecutive messages from same `senderExternalId` within 5 minutes stay in same segment (prevents 5 rapid messages from creating 5 segments)

**`ThreadDetailSheet.tsx` — sub-thread UI:**
- Segment headers: "Thread N" label (channel source name if available from thread metadata)
- Reply composer: show "Reply to Thread N", store selected segment ID, pass `inReplyToExternalMessageId` from that segment's latest message
- Draft banner: show pending `ReplyDraft` (from `thread.drafts[0]`) as dismissible banner above composer

### 2.5 Ingestion Flow (unchanged, just unified)

```
Any source (Discord bot, Discord webhook, chat webhook)
  │
  ▼
POST /api/rest/intake/ingest-from-channel
  │
  ▼
trpc.intake.ingestFromChannel()
  │
  ▼
performIngestion(prisma, input)
  ├─ Upsert Customer (workspaceId + source + externalCustomerId)
  ├─ Dedup on externalMessageId
  ├─ decideDeterministicThreadMatch():
  │    1. externalThreadId match (0.99 confidence)
  │    2. Reply chain match (0.96)
  │    3. Jaccard fingerprint match (≥0.6)
  │    4. New SupportThread (fallback)
  ├─ Create ThreadMessage (INBOUND)
  ├─ Update SupportThread (timestamps, summary, fingerprint)
  └─ Optionally dispatch resolveInboxThreadWorkflow (async LLM re-evaluation)
```

### 2.6 Discord Reply Chain Capture (fix)

The Discord bot was not capturing `message.reference?.messageId` — the reply-to-message link that Discord provides when a user clicks "Reply". Without this, `inReplyToExternalMessageId` is always null and visual sub-thread grouping is blind (every inbound message starts a new segment).

**Fix applied:** `discordMessageToInput()` now maps `message.reference?.messageId` → `inReplyToExternalMessageId`. The `IngestSupportMessageInputSchema` was extended to accept this field, and `ingestFromChannel` passes it through to `performIngestion`. The Discord webhook also maps `message_reference.message_id` → `inReplyToExternalMessageId`.

### 2.7 Dependencies

None. This is a deletion/consolidation effort. No new packages or env vars.

---

## 3. Task Checklist

### Phase 1: Delete dead code (safe, no schema change needed)

```
- [ ] Delete `packages/rest/src/routers/conversation.ts`
- [ ] Remove `conversationRouter` import + registration from `packages/rest/src/root.ts`
- [ ] Remove Conversation-related Zod schemas from `packages/types/src/schemas/index.ts`:
      ListConversationsSchema, UpdateConversationStatusSchema, AssignConversationSchema,
      MergeCustomerIdentitySchema, ListMessagesByConversationSchema,
      SendConversationReplySchema + all their exported types
- [ ] Fix discord-bot.ts backfill dedup: change `prisma.conversationMessage` → `prisma.threadMessage`
      on line ~185 (bug: was checking the empty table)
- [ ] Grep codebase for any remaining imports of deleted schemas/types — remove
- [ ] Verify `npm run type-check` passes
```

### Phase 2: Schema + code update (atomic — must land together)

**Schema changes:**
```
- [ ] In `support.schema.prisma`: modify ReplyDraft — change conversationId FK → threadId FK to SupportThread,
      change basedOnMessageId FK → ThreadMessage
- [ ] In `support.schema.prisma`: add `drafts ReplyDraft[]` to SupportThread model
- [ ] In `support.schema.prisma`: add `basedOnDrafts ReplyDraft[]` to ThreadMessage model
- [ ] In `support.schema.prisma`: remove `customerIdentities` and `messages` relations from ChannelConnection
- [ ] In `support.schema.prisma`: delete Conversation, ConversationMessage, CustomerProfile,
      CustomerChannelIdentity models entirely
- [ ] In `schema.prisma`: remove `customerProfiles`, `conversations` relations from Workspace
- [ ] In `schema.prisma`: remove `assignedConversations` relation from User
```

**Code changes (must happen same commit before db:generate):**
```
- [ ] Update `GenerateReplyDraftSchema` in Zod schemas — rename conversationId → threadId
- [ ] Update `agentRouter.generateDraft` — query supportThread + ThreadMessage,
      create ReplyDraft with threadId instead of conversationId
- [ ] Update `agentRouter.approveDraft` — include thread instead of conversation for workspace check
- [ ] Update `agentRouter.dismissDraft` — same as approveDraft
- [ ] Update `threadRouter.getById` — include drafts (where status: "GENERATED", orderBy: createdAt desc, take: 1)
- [ ] Rewrite `apps/web/src/app/api/webhooks/discord/route.ts` — replace direct
      CustomerProfile/Conversation/ConversationMessage writes with call to
      createCaller().intake.ingestFromChannel()
- [ ] Rewrite `apps/web/src/app/api/webhooks/chat/route.ts` — same approach
```

**Generate + verify:**
```
- [ ] Run `npm run db:generate`
- [ ] Grep for any remaining references to deleted models — fix stragglers
- [ ] Run `npm run type-check` — must pass
- [ ] Run `npm run build` — must pass for web, queue, codex
```

### Phase 3: Migration (destructive, requires backup)

```
- [ ] Back up database (or confirm Conversation tables have no data worth keeping)
- [ ] Run `npm run db:migrate` — drops 4 tables, alters ReplyDraft
```

### Phase 4: Frontend enhancements (can be separate PR)

```
- [ ] Enhance `message-segments.ts` — add time-window + same-speaker fallback grouping
      (consecutive messages from same senderExternalId within 5 min → same segment)
- [ ] Update `ThreadDetailSheet.tsx` — segment headers with "Thread N" labels
- [ ] Update `ThreadDetailSheet.tsx` — pin reply composer to selected segment,
      pass inReplyToExternalMessageId from segment's latest message
- [ ] Update `ThreadDetailSheet.tsx` — show pending ReplyDraft as dismissible banner above composer
- [ ] Update `apps/web/src/actions/inbox.ts` — if any actions reference conversation procedures, update
```

### Phase 5: Cleanup

```
- [ ] Final grep: zero references to Conversation, ConversationMessage, CustomerProfile,
      CustomerChannelIdentity in any .ts file
- [ ] Update CLAUDE.md — remove any mentions of the Conversation model or dual-model architecture
- [ ] Delete this spec's predecessor if any stale docs remain
```

---

## 4. Testing Checklist

### Happy Path

```
- [ ] Discord bot message → SupportThread + ThreadMessage created
- [ ] Same user, same Discord thread → appended to same SupportThread (externalThreadId match)
- [ ] Same user, unrelated message → new SupportThread (fingerprint mismatch, no reply chain)
- [ ] Discord webhook → writes to SupportThread (not Conversation)
- [ ] Chat webhook → writes to SupportThread (not Conversation)
- [ ] /inbox page loads kanban with threads grouped by status
- [ ] /inbox/[threadId] shows messages grouped into visual sub-thread segments
- [ ] Reply from UI creates OUTBOUND ThreadMessage with correct inReplyToExternalMessageId
- [ ] agent.generateDraft creates ReplyDraft linked to SupportThread
- [ ] agent.approveDraft / agent.dismissDraft work against new FK
```

### Validation

```
- [ ] Ingestion rejects empty body → 400
- [ ] Ingestion rejects missing channelConnectionId → 400/404
- [ ] agent.generateDraft rejects invalid threadId → NOT_FOUND
- [ ] Webhooks return 400 for malformed payloads
```

### Edge Cases

```
- [ ] Message with no externalThreadId and no inReplyToExternalMessageId → new thread
- [ ] Duplicate externalMessageId → idempotent, no duplicate
- [ ] Thread with 0 messages → detail page renders empty state
- [ ] Thread with 100+ messages → segments render correctly
- [ ] senderExternalId is null → time-window grouping skips, each message gets own segment
- [ ] resolveInboxThreadWorkflow moves message between threads → UI reflects move on refresh
```

### Auth / Permissions

```
- [ ] Non-workspace-member cannot list threads (FORBIDDEN)
- [ ] Non-workspace-member cannot view thread detail (FORBIDDEN)
- [ ] Non-workspace-member cannot generate/approve/dismiss drafts (FORBIDDEN)
- [ ] ingestFromChannel works without user session (public, auth via channelConnectionId)
```

### UI

```
- [ ] Segment headers show "Thread N" labels
- [ ] Reply composer shows "Reply to Thread N" with selected segment
- [ ] Inbound messages show customer displayName + timestamp
- [ ] Outbound messages show "Team" badge
- [ ] Pending draft visible as banner in thread detail
- [ ] Kanban drag-and-drop status change still works
```

### Build / CI

```
- [ ] npm run db:generate succeeds
- [ ] npm run type-check passes all packages
- [ ] npm run build succeeds for @app/web, @app/queue, @app/codex
- [ ] Zero source-code references to deleted models
```
