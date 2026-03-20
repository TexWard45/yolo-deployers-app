# Engineering Spec: Omnichannel Support Inbox + AI Reply Agent

Assumption for v1: the first two customer-facing channels are `Discord` and `in-app chat`. The existing `apps/web` dashboard becomes the operator console, and `apps/queue` handles ingestion, AI drafting, and delivery retries.

## 1. Job to Be Done

Support and customer success teams need one place to receive, triage, and answer customer questions that arrive from multiple channels without losing context.

- **Who**: workspace support agents, founders, and operators responding to customer questions.
- **What**: ingest inbound messages from Discord and in-app chat into a single workspace inbox, keep the conversation history unified, and let agents reply directly from the web app.
- **Why**: today the team would otherwise switch between tools, miss messages, answer inconsistently, and waste time re-explaining the same context. The AI layer should draft high-quality replies that match each workspace's tone, product details, and escalation rules.
- **Success criteria**:
  - Inbound Discord and in-app messages appear in the correct workspace inbox within 30 seconds.
  - A support agent can open a conversation and send a reply back to the originating channel from `apps/web`.
  - AI can generate a draft reply using workspace-specific instructions, customer context, and recent thread history.
  - Agents can edit, approve, or discard AI drafts before sending.
  - All inbound and outbound messages are stored with audit history and linked to a single conversation record.
  - **When the bot replies on Discord, it creates a thread on the original customer message** rather than posting a flat message in the channel. This keeps each support interaction self-contained and prevents the channel from becoming noisy. For in-app chat the reply appears in the existing chat session (thread semantics are implicit).

## 2. Proposed Flow / Architecture

### Data model changes

Add channel-agnostic support models in `packages/database/prisma/schema.prisma`, then regenerate shared Prisma types into `@shared/types`.

- `ChannelType` enum
  - `DISCORD`
  - `IN_APP`
- `ConversationStatus` enum
  - `OPEN`
  - `PENDING`
  - `RESOLVED`
  - `SPAM`
- `MessageDirection` enum
  - `INBOUND`
  - `OUTBOUND`
- `SenderKind` enum
  - `CUSTOMER`
  - `AGENT`
  - `AI_AGENT`
  - `SYSTEM`
- `DraftStatus` enum
  - `GENERATED`
  - `APPROVED`
  - `SENT`
  - `DISMISSED`
  - `FAILED`

- `ChannelConnection`
  - Belongs to `Workspace`
  - Stores channel type, display name, connection status, and provider-specific metadata
  - Stores non-secret provider identifiers directly, and secret refs indirectly so app code does not spread raw token handling
  - Example fields: `workspaceId`, `type`, `name`, `status`, `externalAccountId`, `configJson`, `createdAt`, `updatedAt`

- `CustomerProfile`
  - Canonical customer record inside a workspace
  - Used to merge the same person across Discord and in-app chat when identity mapping is known
  - Example fields: `workspaceId`, `displayName`, `email`, `externalRef`, `metadataJson`

- `CustomerChannelIdentity`
  - Maps a `CustomerProfile` to one provider identity
  - Example fields: `customerProfileId`, `channelConnectionId`, `externalUserId`, `username`, `displayName`
  - Unique constraint on `(channelConnectionId, externalUserId)`

- `Conversation`
  - The unified support thread inside one workspace
  - Example fields: `workspaceId`, `customerProfileId`, `primaryChannelType`, `status`, `subject`, `assignedToUserId`, `lastMessageAt`, `lastInboundAt`, `lastOutboundAt`
  - **`externalThreadId`** — stores the provider-side thread identifier (e.g., Discord thread/channel ID) once a thread has been created for this conversation. Used on subsequent replies to post into the same thread instead of creating a new one.

- `ConversationMessage`
  - Immutable message/event log for inbound and outbound content
  - Example fields: `conversationId`, `channelConnectionId`, `direction`, `senderKind`, `externalMessageId`, `body`, `rawPayloadJson`, `sentAt`, `deliveryStatus`
  - Unique index on `(channelConnectionId, externalMessageId)` for idempotent webhook ingestion

- `ReplyDraft`
  - AI-generated or manually saved draft linked to a conversation
  - Example fields: `conversationId`, `basedOnMessageId`, `createdByUserId`, `status`, `model`, `promptVersion`, `body`, `metadataJson`

- `WorkspaceAgentConfig`
  - One record per workspace controlling AI behavior
  - Example fields: `workspaceId`, `enabled`, `systemPrompt`, `tone`, `replyPolicy`, `autoDraftOnInbound`, `handoffRulesJson`, `model`

Optional phase-2 tables if the product expands:

- `KnowledgeDocument` for workspace-specific product facts and canned policies
- `ConversationTag` / `Tag` for triage, routing, and reporting
- `SlaPolicy` for first-response and resolution-time targets

All Prisma-generated model types and all Zod schemas should continue to live in `@shared/types`, with no duplicated local input types in `apps/web` or `apps/queue`.

### API layer

Add new tRPC routers under `packages/rest/src/routers/` and merge them in `packages/rest/src/root.ts`.

- `channelConnectionRouter`
  - `listByWorkspace`
  - `createDiscordConnection`
  - `createInAppConnection`
  - `updateConnectionStatus`
  - `disconnect`
- `conversationRouter`
  - `list`
  - `getById`
  - `assign`
  - `updateStatus`
  - `mergeCustomerIdentity`
- `messageRouter`
  - `listByConversation`
  - `sendReply`
  - `resendFailed`
- `agentRouter`
  - `getWorkspaceConfig`
  - `updateWorkspaceConfig`
  - `generateDraft`
  - `approveDraft`
  - `dismissDraft`

Add shared schemas in `packages/types/src/schemas/` such as:

- `CreateChannelConnectionSchema`
- `ListConversationsSchema`
- `SendConversationReplySchema`
- `GenerateReplyDraftSchema`
- `UpdateWorkspaceAgentConfigSchema`
- `MergeCustomerIdentitySchema`

Authorization rules:

- Any workspace member can view conversations for workspaces they belong to.
- Only `OWNER` and `ADMIN` can manage channel connections and AI agent configuration.
- `MEMBER` can reply to conversations but cannot change bot credentials or workspace-level AI policy.
- All tRPC procedures must verify `workspaceId` membership before reads and writes, following the existing workspace-scoped pattern already used by the repo.

Webhooks / provider-facing endpoints in `apps/web`:

- `POST /api/webhooks/discord`
  - Receives Discord message events
  - Validates provider signature or bot auth
  - Normalizes payload and enqueues ingestion work
- `POST /api/webhooks/chat`
  - Receives in-app chat message events
  - Validates request schema
  - Normalizes payload and enqueues ingestion work

Queue responsibilities in `apps/queue`:

- `ingest-support-message.workflow.ts`
  - Deduplicate provider event
  - Resolve `Workspace`, `ChannelConnection`, and `CustomerProfile`
  - Create or update `Conversation`
  - Persist `ConversationMessage`
  - Optionally trigger AI draft generation
- `generate-reply-draft.workflow.ts`
  - Load recent thread history and workspace AI config
  - Produce a draft and save `ReplyDraft`
- `deliver-support-reply.workflow.ts`
  - **Thread-first delivery**: before sending, check `Conversation.externalThreadId`.
    - If a thread already exists, post the reply into that thread.
    - If no thread exists yet, create a new thread on the original inbound message (using the stored `externalMessageId` of the first inbound `ConversationMessage`) and persist the resulting thread ID back to `Conversation.externalThreadId`.
  - For Discord this means calling `POST /channels/{channel.id}/messages` with `message_reference` to create or continue a thread. All subsequent replies reuse the same thread.
  - For in-app chat the reply is delivered into the existing chat session (thread semantics are implicit in the widget).
  - Retry transient failures
  - Persist final delivery status

Keep workflow implementations in `apps/queue/src/workflows/` and activity implementations in `apps/queue/src/activities/`, registered through the existing index and registry files.

### Frontend

Use the existing authenticated dashboard in `apps/web` as the support operator UI.

New routes:

- `/inbox`
  - Conversation list for the active workspace
  - Filters for status, assignee, and channel
- `/inbox/[conversationId]`
  - Unified thread view
  - Reply composer
  - AI draft panel
- `/settings/channels`
  - Connect and inspect Discord / in-app channels
- `/settings/ai-agent`
  - Configure workspace-specific AI prompts, tone, and auto-draft behavior

Suggested component structure in `apps/web/src/components/`:

- `inbox/ConversationList.tsx`
- `inbox/ConversationThread.tsx`
- `inbox/ReplyComposer.tsx`
- `inbox/AiDraftCard.tsx`
- `settings/ChannelConnectionCard.tsx`
- `settings/AgentConfigForm.tsx`

Rendering strategy:

- Use server components for initial page data loads and access checks.
- Keep interactive message composer, AI draft actions, and filter controls in `"use client"` components only.
- Use `trpc` server caller for initial loads and `useTRPC` + React Query for client-side mutations and refreshes.
- For v1, prefer polling or explicit refresh after send rather than introducing a separate realtime transport. Reply sending is still immediate because the user submits directly from the app; realtime streaming can be added later if needed.

### Flow diagram

1. A customer sends a message from Discord or the in-app chat widget.
2. The provider calls the matching webhook route in `apps/web`.
3. The route validates the payload, maps it to a normalized event shape from `@shared/types`, and hands it off to `apps/queue`.
4. The ingestion workflow resolves the target workspace and channel connection.
5. The workflow upserts the customer identity and finds or creates the correct conversation.
6. The workflow stores the inbound message in `ConversationMessage`.
7. If workspace AI drafting is enabled, the draft-generation workflow builds context from recent messages, customer metadata, and `WorkspaceAgentConfig`, then stores a `ReplyDraft`.
8. A support agent opens `/inbox/[conversationId]` in `apps/web` and sees the full thread plus the latest AI draft.
9. The agent edits the draft or writes their own message, then submits `message.sendReply`.
10. **The delivery workflow checks whether a Discord thread already exists for this conversation (`Conversation.externalThreadId`). If not, it creates a new thread on the original customer message; if so, it posts the reply into the existing thread.** The outbound message and delivery status are recorded in `ConversationMessage`.
11. Any follow-up messages from the customer in the same Discord thread are ingested back into the same `Conversation`, keeping the full history unified.

### Dependencies

New dependencies or services likely needed:

- LLM provider SDK for draft generation
- Discord bot or webhook integration (must support thread creation via `message_reference` or `startThread` APIs)
- In-app chat widget or event transport for site messaging
- Optional encryption helper for provider secrets stored against `ChannelConnection`

New env vars in `@shared/env`:

- `LLM_API_KEY`
- `LLM_MODEL_DEFAULT`
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_WEBHOOK_SECRET`
- `IN_APP_CHAT_SIGNING_SECRET`
- `SUPPORT_SECRET_ENCRYPTION_KEY`

## 3. Task Checklist

### Schema / Data

- [ ] Add support-domain enums and models to `packages/database/prisma/schema.prisma` for channel connections, customer identities, conversations, messages, drafts, and workspace AI config.
- [ ] Add `externalThreadId` field to the `Conversation` model to store the provider-side thread identifier for threaded replies.
- [ ] Run `npm run db:generate` and export new Prisma types through `packages/types/src/index.ts`.
- [ ] Add Zod schemas for connection setup, conversation queries, reply sending, and AI config in `packages/types/src/schemas/`.
- [ ] Add a migration plan for provider secret storage, idempotency keys, and message delivery status fields.

### Backend / API

- [ ] Create `channelConnection`, `conversation`, `message`, and `agent` routers in `packages/rest/src/routers/`.
- [ ] Register the new routers in `packages/rest/src/root.ts` and keep all access workspace-scoped through `ctx.prisma`.
- [ ] Implement webhook route handlers under `apps/web/src/app/api/` for Discord and in-app chat ingestion.
- [ ] Add queue workflows and activities for support ingestion, AI draft generation, and outbound delivery in `apps/queue/src/workflows/` and `apps/queue/src/activities/`.
- [ ] Implement thread-creation logic in the Discord delivery activity: create a thread on the original message when `externalThreadId` is null, then persist the thread ID back to the `Conversation` record.
- [ ] Implement thread-reuse logic: when `externalThreadId` already exists, post replies into the existing thread instead of creating a new one.
- [ ] Handle Discord thread ingestion: when a customer replies inside an existing bot-created thread, map the inbound message back to the correct `Conversation` using `externalThreadId`.
- [ ] Centralize new env parsing in `packages/env/src/` so app code avoids direct `process.env` access.

### Frontend / UI

- [ ] Add an inbox index page and conversation detail page in `apps/web/src/app/(dashboard)/`.
- [ ] Build typed inbox components for conversation list, thread timeline, reply composer, draft actions, and empty/loading states under `apps/web/src/components/`.
- [ ] Add settings screens for channel connections and workspace AI configuration, keeping only interactive forms in client components.
- [ ] Add clear channel badges, assignment state, delivery status, and draft provenance in the thread UI so agents can trust what they are sending.
- [ ] Show a "Replied in thread" indicator in the conversation timeline for outbound messages that were delivered as Discord thread replies.

### Wiring

- [ ] Connect server component page loads to `trpc` server callers and client mutations to `useTRPC` hooks.
- [ ] Wire workspace selection into inbox queries so each view is scoped to the active workspace membership from session data.
- [ ] Ensure send-reply mutations write an optimistic local state and then reconcile with persisted delivery status.
- [ ] Add provider payload normalization shared types so `apps/web` and `apps/queue` do not drift on event shape.

### Cleanup

- [ ] Re-export any new shared schemas and model types from `@shared/types` entry points.
- [ ] Update `CLAUDE.md` only if the architecture conventions materially change beyond the current workspace/tRPC guidance.
- [ ] Remove any duplicated local input types introduced during implementation and replace them with `@shared/types` imports.

## 4. Testing Checklist

- [ ] Happy path: a Discord inbound message creates a conversation, appears in `/inbox`, generates a draft, and successfully sends an agent reply back to Discord **as a thread on the original message**.
- [ ] Happy path: an in-app chat message follows the same unified conversation flow and stores both inbound and outbound messages.
- [ ] **Thread creation**: the first outbound reply to a Discord conversation creates a new thread on the original customer message and stores `externalThreadId` on the `Conversation`.
- [ ] **Thread reuse**: subsequent replies to the same Discord conversation post into the existing thread (same `externalThreadId`) rather than creating a new thread.
- [ ] **Thread ingestion**: when a customer replies inside a bot-created Discord thread, the inbound message is correctly associated with the existing `Conversation`.
- [ ] **Thread fallback**: if thread creation fails (e.g., permissions, archived channel), the delivery activity falls back to a flat channel reply, logs the error, and does not leave `externalThreadId` in an inconsistent state.
- [ ] Validation: invalid webhook signatures, malformed payloads, missing `workspaceId`, and invalid draft generation inputs are rejected with clear errors.
- [ ] Validation: only valid enum states and supported channel types are accepted in tRPC inputs.
- [ ] Edge cases: duplicate provider events do not create duplicate messages because `(channelConnectionId, externalMessageId)` remains idempotent.
- [ ] Edge cases: if a customer messages again on the same channel, the system appends to the existing open conversation instead of creating a new one.
- [ ] Edge cases: if AI draft generation fails, the conversation still lands in the inbox with a visible fallback state for manual reply.
- [ ] Edge cases: delivery retries mark outbound messages as failed after retry exhaustion without losing the draft or operator action history.
- [ ] Auth / Permissions: non-members cannot read or reply to conversations outside their workspace.
- [ ] Auth / Permissions: `MEMBER` users can reply but cannot manage channel credentials or workspace AI policy.
- [ ] UI: inbox list, thread view, and settings screens render correctly on mobile and desktop.
- [ ] UI: loading, empty, and provider-error states are visible and understandable.
- [ ] Type safety: `npm run type-check` passes across the monorepo.
- [ ] Lint: `npm run lint` passes.
- [ ] Build: `npm run build` succeeds, including `npm run build --workspace @app/queue`.
