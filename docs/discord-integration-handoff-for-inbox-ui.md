# Discord Integration Handoff: Hooking Into Inbox UI

This document explains how to connect Discord ingestion to the existing inbox/thread UI without changing UI components.

## Goal

When a Discord customer message arrives:

1. Identify customer
2. Open or reuse support thread
3. Store message
4. Set thread status for support visibility
5. Let existing `/inbox` and `/inbox/[threadId]` UI render updates automatically

## Existing Integration Contract

The UI is already wired to these tRPC procedures in `@shared/rest`:

1. `intake.upsertExternalCustomer`
2. `intake.upsertExternalThread`
3. `intake.ingestExternalMessage`
4. `intake.touchThreadStatusFromIngestion`

Recommended primary entrypoint:

1. Use `intake.ingestExternalMessage` for normal inbound Discord messages.
2. Use the other procedures for advanced sync/backfill workflows.

## Required Payload Mapping (Discord -> Intake)

Map Discord event fields into `ingestExternalMessage`:

1. `workspaceId`: internal workspace to route this Discord server/channel into
2. `source`: `"DISCORD"`
3. `externalCustomerId`: Discord user ID
4. `externalThreadId`: Discord channel/thread ID
5. `customerDisplayName`: Discord display name / username
6. `customerAvatarUrl`: Discord avatar URL (optional)
7. `customerEmail`: optional if known from your own mapping
8. `messageBody`: Discord message content
9. `externalMessageId`: Discord message ID (for idempotency)
10. `title`: thread title (optional)
11. `metadata`: structured raw context (attachments, guild/channel IDs, etc.)

## Behavior Guarantees

`intake.ingestExternalMessage` already does:

1. Upsert customer by `(workspaceId, source, externalCustomerId)`
2. Upsert thread by `(workspaceId, source, externalThreadId)`
3. Insert inbound message (idempotent when `externalMessageId` is provided)
4. Update `lastMessageAt`
5. Set thread status to `WAITING_REVIEW`

This is enough to light up UI list/detail immediately.

## Server-Side Usage Example

Use server-side caller (do not expose this directly to browser clients):

```ts
import { createCaller, createTRPCContext } from "@shared/rest";

export async function ingestDiscordMessage(event: {
  workspaceId: string;
  serviceUserId: string;
  discordUserId: string;
  discordThreadId: string;
  discordMessageId: string;
  displayName: string;
  avatarUrl?: string;
  content: string;
  title?: string;
  guildId: string;
  channelId: string;
}) {
  const trpc = createCaller(
    createTRPCContext({ sessionUserId: event.serviceUserId }),
  );

  return trpc.intake.ingestExternalMessage({
    workspaceId: event.workspaceId,
    source: "DISCORD",
    externalCustomerId: event.discordUserId,
    externalThreadId: event.discordThreadId,
    customerDisplayName: event.displayName,
    customerAvatarUrl: event.avatarUrl,
    messageBody: event.content,
    externalMessageId: event.discordMessageId,
    title: event.title,
    metadata: {
      guildId: event.guildId,
      channelId: event.channelId,
      provider: "discord",
    },
  });
}
```

## Workspace Routing Requirement

Discord events must be mapped to an internal `workspaceId`.

Recommended approach:

1. Maintain a mapping table from Discord `guildId`/`channelId` -> internal `workspaceId`.
2. Maintain one integration/service user per workspace (or shared service user added to each workspace).
3. Pass that member ID as `sessionUserId` when creating tRPC context.

## Status Update Hooks (Optional)

If Discord events imply state changes, use:

1. `intake.touchThreadStatusFromIngestion` for explicit status transitions from webhook pipeline.

Examples:

1. Bot asks customer for more details -> `WAITING_CUSTOMER`
2. New inbound customer reply -> `WAITING_REVIEW`
3. Escalation tag from bot/automation -> `ESCALATED`

## Idempotency and Retries

To avoid duplicate UI messages:

1. Always send `externalMessageId` (Discord message ID).
2. Retries are safe; duplicate message IDs are ignored by unique constraint.

## Validation Checklist for Teammate

1. Send one Discord message -> thread appears in `/inbox`.
2. Send second message in same Discord thread -> same internal thread updates.
3. Retry same webhook payload -> no duplicate message row.
4. Thread shows status `WAITING_REVIEW` after inbound message.
5. Open `/inbox/[threadId]` -> timeline shows inbound message + metadata-backed behavior.

## Notes

1. Current UI also includes a manual intake path for local testing; this can remain for QA.
2. Intake procedures now require authenticated context (no client-supplied `userId` field).
