# Engineering Spec: Inbox Thread Grouping and Summary Continuity

## 1. Job to Be Done

Support operators need inbound and outbound customer messages to stay grouped in the same inbox thread so they can track one issue as one conversation.

- **Who** is the user/actor?
  - Support agents and workspace admins working in `/inbox`.
- **What** do they need to accomplish?
  - Ingest customer messages into one thread per issue (not one thread per message).
  - Identify which customer owns the thread.
  - See and maintain a concise thread summary as messages evolve.
  - Keep future replies attached to the same thread, even after multiple agent/customer back-and-forth messages.
- **Why** — what's the motivation or pain point?
  - Today grouping breaks when upstream `externalThreadId` is missing or when manual intake generates random IDs.
  - Operators lose context because one real customer issue can fragment into many small threads.
  - Reply continuity is harder when we cannot reliably map a new message to the right existing thread.
- **Success criteria** — how do we know this is working?
  - Three sequential inbound messages from the same customer about the same issue are stored under one `SupportThread` in `/inbox`.
  - If agents reply in that thread, later customer follow-ups are still attached to the same thread.
  - Every thread shows a stable customer identity and an updated summary.
  - Duplicate webhook/manual retries do not create duplicate `ThreadMessage` rows.

## 2. Proposed Flow / Architecture

This phase extends the existing `/inbox` stack already used in this repo (`SupportThread` + `ThreadMessage`, `intakeRouter`, `threadRouter`, `messageRouter`) instead of migrating UI to `Conversation` models.

### Data model changes

Add fields to `packages/database/prisma/thread.schema.prisma`:

- `SupportThread`
  - `summary String?` — current operator-facing summary.
  - `summaryUpdatedAt DateTime?` — when summary last changed.
  - `issueFingerprint String?` — normalized issue signature for fallback grouping.
  - `lastInboundAt DateTime?` and `lastOutboundAt DateTime?` — improve grouping and status automation.
  - Indexes:
    - `@@index([workspaceId, customerId, status, lastMessageAt])` for candidate-thread lookup.
    - `@@index([workspaceId, customerId, issueFingerprint])` for issue-key matching.
- `ThreadMessage`
  - `inReplyToExternalMessageId String?` — provider reply-chain hint.
  - `messageFingerprint String?` — normalized text fingerprint used during grouping analysis.
  - `senderExternalId String?` (optional but recommended) — preserve provider sender identity per event for audit/debug.
  - Indexes:
    - `@@index([threadId, inReplyToExternalMessageId])`
    - `@@index([externalMessageId])` (non-unique; useful for reply-chain lookup by workspace join)

Add or adjust shared Zod schemas in `packages/types/src/schemas/index.ts`:

- Extend `IngestExternalMessageSchema` with optional grouping hints:
  - `inReplyToExternalMessageId?: string`
  - `threadGroupingHint?: string` (optional external/provider grouping key)
- Add new `GenerateThreadSummarySchema` input for internal summary updates (router or workflow trigger).

Prisma requirements:

- Create migration via `npm run db:migrate` and commit migration files.
- Regenerate Prisma types via `npm run db:generate`.

### API layer

Keep tRPC procedures in `@shared/rest` and `ctx.prisma` access pattern:

- Update `intake.ingestExternalMessage` (`packages/rest/src/routers/intake.ts`)
  - Replace direct upsert-by-`externalThreadId` only behavior with a **thread resolution pipeline**:
    1. Resolve/upsert `Customer`.
    2. Match by `(workspaceId, source, externalThreadId)` when `externalThreadId` exists.
    3. Else match by `inReplyToExternalMessageId` by finding the parent `ThreadMessage`.
    4. Else match against recent open threads for same customer using `issueFingerprint` + similarity score.
    5. Else create a new thread.
  - Update thread timestamps (`lastMessageAt`, `lastInboundAt`) and `status` (`WAITING_REVIEW` on inbound).
  - Trigger/update summary generation after message write.
- Update `message.createOutgoingDraft` (`packages/rest/src/routers/message.ts`)
  - Persist outbound message metadata needed for continuity (e.g., outbound `externalMessageId` when available from channel delivery callback).
  - Update `lastMessageAt`, `lastOutboundAt`, and optionally keep `status` in `WAITING_CUSTOMER`.
- Add helper module in `packages/rest/src/routers/helpers/` (or equivalent)
  - `resolveThreadForInboundMessage(...)`
  - `buildIssueFingerprint(...)`
  - `scoreThreadSimilarity(...)`

Authorization:

- Keep existing workspace membership checks.
- No cross-workspace thread linkage allowed when using reply-chain lookup.

### Frontend

- `apps/web/src/actions/inbox.ts`
  - Stop generating random IDs for every manual message.
  - Use stable `externalCustomerId` strategy for manual mode (prefer explicit customer identifier; fallback deterministic slug).
  - Allow optional `threadGroupingHint` or explicit `threadId` for QA/debug tools.
- `apps/web/src/components/inbox/ThreadDetailSheet.tsx` and thread list cards
  - Display `summary` near title/subtitle.
  - Add a small “messages in thread” context block to confirm grouping behavior.
- `apps/web/src/components/inbox/ManualIntakeForm.tsx`
  - Add optional fields for `customerExternalId` and `threadGroupingHint` (for deterministic local testing).
  - Keep default UX simple; advanced fields can be collapsible.

Server vs client boundaries remain unchanged:

- Server components load via server caller.
- Client components handle send/mutation interactions.

### Flow diagram

1. Customer sends inbound message (`hey`, then `i have this issue`, then `<issue details>`).
2. Intake normalizes payload and upserts `Customer` using a stable customer identity key.
3. Intake tries thread resolution by provider thread ID.
4. If no provider thread ID, intake tries reply-chain (`inReplyToExternalMessageId`).
5. If no reply-chain, intake computes fingerprint/similarity and checks recent open threads for that customer.
6. If match is above threshold, message is appended to that thread.
7. If no match, create a new `SupportThread` with initial summary and fingerprint.
8. Agent replies from `/inbox` in that thread.
9. Outbound write updates `lastOutboundAt` and stores metadata for continuity.
10. Customer replies later; intake resolves back to the same thread via provider ID, reply-chain, or fingerprint fallback.
11. Thread summary is refreshed and remains visible in `/inbox`.

### ASCII graph

```text
Customer (A)
  ├─ msg1: "hey"
  ├─ msg2: "i have this issue"
  └─ msg3: "<issue details>"
          |
          v
IngestExternalMessage
  |
  +--> Match by externalThreadId? ---------- yes --> append to Thread T1
  |                                           |
  |                                           v
  +--> no --> Match by inReplyToMessageId? -- yes --> append to Thread T1
  |                                           |
  |                                           v
  +--> no --> Similarity(issueFingerprint)? - yes --> append to Related Thread T1
  |                                           |
  |                                           v
  +--> no ------------------------------------------> create New Thread T2

Thread state result:
  - Thread T1 keeps msg1 + msg2 + msg3 + agent replies + future follow-ups
  - Thread summary is updated after each inbound/outbound message
```

### Issue UI example

```text
/inbox (kanban/list card view)

+----------------------------------------------------------------------------------+
| [NEW]  Customer Account (DISCORD)                            5m ago  •  3 msgs |
| Title: Issue thread                                                             |
| Summary: [summary content hidden]                                               |
| Assignee: Unassigned                                                            |
+----------------------------------------------------------------------------------+
```

```text
/inbox/[threadId] (detail sheet/page)

Header:
  Issue thread
  Customer Account • Source: DISCORD                         Status: NEW

Timeline (single grouped thread T1):
  [Inbound - Customer]  10:01 PM
  "[message content hidden]"

  [Inbound - Customer]  10:03 PM
  "[message content hidden]"

  [Inbound - Customer]  10:05 PM
  "[message content hidden]"

  [Outbound - Team]     10:08 PM
  "[message content hidden]"

  [Inbound - Customer]  10:10 PM
  "[message content hidden]"

Right sidebar:
  Status: NEW
  Customer: Customer Account
  Source: DISCORD
  Assigned to: Unassigned
  Summary:
    "[summary content hidden]"
```

```text
What this proves in UI:
  - Multiple related inbound messages are grouped into one thread (T1)
  - Outbound replies stay inside the same thread
  - Follow-up customer replies continue in T1
  - Summary updates as the thread evolves
```

### Linked thread UI (like your example)

```text
/inbox/[threadId] with linked sub-thread blocks

Top context bar:
  [Slack icon] #ext-hamming-wellthapp   |   #customers   |   + Internal thread

Issue: [issue title hidden]

Thread 1 • #ext-hamming-wellthapp
  Participant A  Feb 20, 1:32 AM
  "[message content hidden]"

Thread 2 • #ext-hamming-wellthapp
  Participant B  Feb 20, 1:33 AM
  "[message content hidden]"

Thread 3 • #ext-hamming-wellthapp
  Participant B  Feb 20, 1:33 AM
  "[message content hidden]"
    Participant A  Mar 4, 1:04 AM
    "[message content hidden]"
    Participant A  Mar 4, 10:05 PM
    "[message content hidden]"
    Participant B  Mar 4, 10:05 PM
    "[message content hidden]"
    ...

Reply composer (pinned target):
  Reply to Thread 3 • #ext-hamming-wellthapp
  [Write a reply...]
```

```text
Backend mapping for this UI:
  - SupportThread = one issue container (entire page context)
  - ThreadMessage rows are grouped into visual "Thread N" blocks by:
      1) root external message id (preferred), or
      2) inReplyToExternalMessageId chain, or
      3) time-window + same speaker fallback
  - Composer stores which visual block is active (reply target),
    then writes outbound message with inReplyToExternalMessageId
```

```text
What this adds beyond current UI:
  - Clear linked conversation segments inside one issue
  - Reply stays attached to the selected segment ("Reply to Thread N")
  - Better readability for long back-and-forth in one customer issue
```

### Dependencies

No required new external services for v1 of this feature.

Optional dependencies (only if needed):

- Lightweight text similarity helper package; preferred approach is in-repo utility to avoid dependency churn.

No new env vars required for baseline implementation.

### Decision record: Hybrid matching with Temporal LLM fallback

```text
Decision ID: DEC-001
Status: Accepted
Date: 2026-03-21
```

**Decision**

- Use deterministic matching as the primary path.
  - Order: `externalThreadId` -> `inReplyToExternalMessageId` -> fingerprint similarity.
- Only call LLM when deterministic confidence is below threshold.
- LLM call must run in a Temporal **activity** (network boundary), not in workflow logic.
- If LLM is unavailable or times out, fallback to deterministic decision (never block ingestion).

**Confidence policy**

- `>= 0.85`: auto-attach to matched thread.
- `0.60 - 0.84`: attach with review flag (or route to manual review queue).
- `< 0.60`: create new thread.

**Why this decision**

- Improves precision for easy cases by keeping deterministic behavior stable.
- Reduces wrong auto-links by using LLM only for ambiguous cases.
- Controls cost/latency because LLM is not called on every message.
- Keeps Temporal workflows deterministic and resilient.

**Temporal shape**

- Workflow: `ingestSupportMessageWorkflow` orchestrates sequence.
- Activities:
  - `deterministicThreadMatchActivity`
  - `llmThreadMatchActivity` (conditional)
  - `persistThreadMessageActivity`
  - `refreshThreadSummaryActivity`

**Guardrails**

- Add idempotency key per inbound event (`externalMessageId`).
- Add timeout + retries on `llmThreadMatchActivity`.
- Add structured logs: matcher used, confidence, final decision, fallback reason.

**Success metrics**

- Auto-link precision (target: high, monitored weekly).
- Manual re-link rate (target: decreasing trend).
- Over-split rate (new thread created when should have matched).
- LLM invocation rate (% of inbound events).

### Execution task list (recommended order)

- [ ] Task 1: Add decision constants and thresholds (`0.85`, `0.60`) in shared config for inbox matching.
- [ ] Task 2: Implement deterministic matcher helper (`externalThreadId` -> reply-chain -> similarity) with confidence output.
- [ ] Task 3: Add Temporal activity `llmThreadMatchActivity` with typed input/output contract in `@shared/types`.
- [ ] Task 4: Update ingest workflow orchestration to call LLM activity only when deterministic confidence is low.
- [ ] Task 5: Add resilient fallback path (LLM timeout/error => deterministic path) and idempotency enforcement.
- [ ] Task 6: Persist match decision metadata on message/thread (`matcherType`, `confidence`, `reviewRequired`).
- [ ] Task 7: Update thread detail read path to expose grouped segment payload for `Thread N` UI blocks.
- [ ] Task 8: Update UI composer to support “Reply to Thread N” target and persist `inReplyToExternalMessageId`.
- [ ] Task 9: Add observability counters/logs for precision, re-links, over-split, and LLM usage rate.
- [ ] Task 10: Run controlled rollout (deterministic-only first, then enable LLM fallback behind feature flag).

## 3. Task Checklist

### Schema / Data

- [ ] Add `summary`, `summaryUpdatedAt`, `issueFingerprint`, `lastInboundAt`, `lastOutboundAt` to `SupportThread` in `packages/database/prisma/thread.schema.prisma`.
- [ ] Add `inReplyToExternalMessageId`, `messageFingerprint`, `senderExternalId` to `ThreadMessage` in `packages/database/prisma/thread.schema.prisma`.
- [ ] Add indexes for customer+status candidate lookups and reply-chain lookups.
- [ ] Run `npm run db:migrate` and commit migration files in `packages/database/prisma/migrations/`.
- [ ] Run `npm run db:generate` to refresh `packages/types/src/prisma-generated/`.
- [ ] Extend/add Zod schemas in `packages/types/src/schemas/index.ts` for new intake fields and summary update inputs.

### Backend / API

- [ ] Implement `resolveThreadForInboundMessage` helper (provider thread ID -> reply-chain -> fingerprint similarity -> create thread).
- [ ] Refactor `intake.ingestExternalMessage` to use resolver helper and update summary/timestamps/status.
- [ ] Update `message.createOutgoingDraft` to persist outbound continuity metadata and status/timestamps.
- [ ] Add message-link grouping helper for UI (`rootMessageId`/reply-chain resolver) so timeline can render visual `Thread N` blocks.
- [ ] Add unit tests for resolver decisions and idempotency behavior.
- [ ] Keep all access checks workspace-scoped and forbid cross-workspace linking.

### Frontend / UI

- [ ] Update `createManualInboundMessage` in `apps/web/src/actions/inbox.ts` to use stable manual customer identity (no per-message random customer IDs).
- [ ] Add optional advanced manual intake fields for deterministic grouping tests.
- [ ] Show thread summary in inbox card and detail views.
- [ ] Add subtle UI indicator that messages are grouped in a single thread timeline.
- [ ] Render grouped message segments in detail view as `Thread 1`, `Thread 2`, `Thread 3` blocks (linked-thread layout).
- [ ] Add “Reply to Thread N” composer target selection and keep selected segment visible in the composer header.

### Wiring

- [ ] Ensure thread summary refresh runs after inbound and outbound writes (synchronous initially; can be moved to queue later).
- [ ] Ensure reply continuity metadata from channel delivery can populate outbound `externalMessageId` when available.
- [ ] Keep `/inbox` routes using existing `threadRouter`/`messageRouter` contracts; no migration to `conversationRouter` in this phase.
- [ ] Return grouped timeline payload (flat messages + computed segment ids/labels) from thread detail read path.

### Cleanup

- [ ] Export any new shared types/schemas from `@shared/types` barrel.
- [ ] Remove any temporary inline grouping logic duplicated across routers/actions.
- [ ] Update docs if grouping contract for external integrations changes.

## 4. Testing Checklist

### Happy path

- [ ] Ingest three inbound messages from the same customer and same issue; verify only one `SupportThread` and three `ThreadMessage` records in that thread.
- [ ] Send outbound reply from `/inbox`, then ingest follow-up inbound; verify follow-up still lands in the same thread.
- [ ] Verify summary is created on first inbound and updated after subsequent messages.

### Validation

- [ ] Reject invalid payload when `workspaceId`, `externalCustomerId`, or `messageBody` is missing.
- [ ] Reject invalid `inReplyToExternalMessageId` type and return clear validation errors.
- [ ] Validate status transitions continue to enforce allowed enum values.

### Edge cases

- [ ] Duplicate inbound event (`externalMessageId` repeated) does not create duplicate messages.
- [ ] Greeting-only message (`hey`) followed by detailed issue still groups correctly under same thread when similarity fallback applies.
- [ ] New unrelated issue from same customer creates a new thread when similarity/fingerprint falls below threshold.
- [ ] Closed thread does not absorb new inbound messages unless explicit provider thread ID maps to it.
- [ ] Concurrent inbound writes for same customer do not create parallel duplicate threads.

### Auth / Permissions

- [ ] Non-members cannot ingest messages into a workspace.
- [ ] Non-members cannot read grouped thread details/messages.
- [ ] Cross-workspace reply-chain references are blocked.

### UI

- [ ] `/inbox` displays summary/customer/thread message count correctly on desktop and mobile.
- [ ] Thread detail sheet/page shows all grouped messages in chronological order.
- [ ] Loading and error states still behave correctly while sending replies.

### Type safety

- [ ] `npm run type-check` passes.

### Lint

- [ ] `npm run lint` passes.

### Build

- [ ] `npm run build` succeeds.
