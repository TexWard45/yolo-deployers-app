# Eng Spec: Thread Matching v2 — Workspace-Wide Matching + Time-Proximity + Inline LLM

## 1. Job to Be Done

- **Who**: Support agents viewing the inbox; end-users sending messages via Discord or in-app chat.
- **What**: When **any** user in a workspace sends a message about an existing issue, it must land on the **same** `SupportThread` — regardless of who sent it. Multiple users reporting the same issue = one thread. Rapid-fire messages from the same user = one thread.
- **Why**: The current matching has two fundamental problems:
  1. **Candidate scope is per-customer** — `performIngestion` only queries threads where `customerId = sender`. If user A reports "trash code on settings page" and user B says "i need to fix this" (same issue), they'll never match because B's candidates don't include A's threads.
  2. **Jaccard similarity is keyword-only** — even within the same customer, _"i need to fix this"_ has zero token overlap with _"who write trash code setting page"_ (Jaccard = 0). The LLM fallback fires async _after_ a new thread is already created, causing orphan threads that later get merged.
- **Success criteria**:
  1. Messages about the same issue from **different users** in the same workspace match to one thread.
  2. Rapid-fire messages from the same user within a configurable time window (default 10 min) always land on the most-recent open thread — no orphans.
  3. Messages outside the time window but semantically related to an existing thread are matched before a new thread is created (inline LLM, not async).
  4. No regression on deterministic matches (external thread ID, reply chain, high Jaccard overlap).
  5. p99 ingestion latency stays under 3 s (inline LLM only fires when deterministic match fails AND candidates exist).

---

## 2. Proposed Flow / Architecture

### Root Cause

```
tokenize("i need to fix this") → ["need", "fix"]        (2 tokens)
tokenize("who write trash code setting page") → ["who", "write", "trash", "code", "setting", "page"]  (6 tokens)

intersection = 0 → Jaccard = 0/8 = 0.0 → new_thread
```

The async LLM resolves it correctly, but the damage is done — a new `SupportThread` was already created in the transaction.

### New Matching Waterfall

```
1. External thread ID match          → confidence 0.99  (unchanged)
2. Reply chain match                 → confidence 0.96  (unchanged)
3. ★ Time-proximity match (NEW)      → confidence 0.92
4. Fingerprint / Jaccard match       → confidence varies (unchanged)
5. ★ Inline LLM match (CHANGED)     → confidence varies (was async, now sync)
6. Create new thread                 → fallback
```

### Critical Fix: Workspace-Wide Candidate Query

**Current bug**: `performIngestion` (intake.ts:145-162) filters candidates by `customerId: customer.id`. This means user A's thread about "trash code on settings page" is **invisible** when user B sends "i need to fix this". They can never match.

**Fix**: Change the candidate query to be **workspace-wide** — fetch open threads for the entire workspace (scoped by `workspaceId + source`), not just the sender's threads. The same customer's threads should be ranked higher (boost), but other customers' threads must be included as candidates.

```ts
// BEFORE (per-customer — broken)
const candidateThreads = await tx.supportThread.findMany({
  where: {
    workspaceId, customerId: customer.id, source, status: { not: "CLOSED" },
  },
  take: 10,
});

// AFTER (workspace-wide)
const candidateThreads = await tx.supportThread.findMany({
  where: {
    workspaceId, source, status: { not: "CLOSED" },
  },
  orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
  take: 20, // wider net since workspace-wide
});
```

### Strategy 3: Time-Proximity Match (new)

**Logic**: If the **same customer** has an open thread with `lastInboundAt` within `RECENCY_WINDOW_MS` (default 10 minutes), and no explicit `externalThreadId` is provided, match to that most-recent thread. Time-proximity is scoped to same-customer only (rapid-fire from same person = same thread).

**Rationale**: In Discord channels (no native threading), rapid-fire messages from the same user are almost always part of the same conversation. This handles the "4 messages in 3 minutes" pattern.

**Configurable per workspace**: The recency window can be stored on `WorkspaceAgentConfig` as `threadRecencyWindowMinutes` (default 10).

**Edge case — multiple open threads**: Pick the one with the most recent `lastInboundAt`. If `externalThreadId` is explicitly provided, skip this strategy.

**Note**: Time-proximity is same-customer only. Cross-customer matching (user B's message about same issue as user A) is handled by Jaccard + inline LLM operating on the workspace-wide candidate set.

### Strategy 5: Inline LLM (changed from async)

**Current behavior**: Deterministic match fails → new thread created in DB → async Temporal workflow fires → LLM matches → `applyInboxThreadResolution` moves the message to the correct thread.

**New behavior**: Deterministic match fails AND candidates exist → call LLM **inline** (synchronous) before creating the thread → use LLM result to decide thread ID → single thread creation, no orphan.

**Implementation**: Extract the LLM call from `llmThreadMatchActivity` into a reusable function in `@shared/rest` (no Temporal dependency). Call it from `performIngestion` when deterministic strategies all fail but `candidateThreads.length > 0`.

**Timeout/fallback**: If the inline LLM call takes > 5 s or fails, fall through to new_thread + dispatch async workflow as today. This preserves the current resilience.

### Data Model Changes

**`WorkspaceAgentConfig`** — add field:

```prisma
threadRecencyWindowMinutes Int @default(10)
```

No new models needed. No schema changes to `SupportThread` or `ThreadMessage`.

### API Layer Changes

- **No new tRPC routers**. Changes are internal to `performIngestion` in `packages/rest/src/routers/intake.ts`.
- **No new Zod schemas** for external input. The recency window is a workspace config field.

### Frontend Changes

- **Optional**: Add `threadRecencyWindowMinutes` to the workspace agent settings page (existing settings UI). Low priority — default of 10 min works for most workspaces.

### Flow Diagram

```
1. Message arrives at performIngestion()
2. Upsert Customer
3. Deduplicate by externalMessageId (existing)
4. Look up existingThreadByExternalId (existing)
5. Look up replyChainThread (existing)
6. ★ Fetch candidateThreads WORKSPACE-WIDE (was per-customer, now all open threads for workspace+source, take 20)
7. Run decideDeterministicThreadMatch():
   a. External thread ID? → match (0.99)
   b. Reply chain? → match (0.96)
   c. ★ Time-proximity (same customer only)? → check most-recent same-customer candidate's lastInboundAt
      - Within recency window AND no explicit new externalThreadId? → match (0.92)
   d. Jaccard fingerprint ≥ 0.6? → match (varies) — now runs against ALL workspace threads
   e. No match found
8. ★ If no deterministic match AND candidates exist:
   a. Call LLM inline (5s timeout) — LLM sees all workspace threads as candidates
   b. LLM returns matchedThreadId with confidence ≥ 0.85? → use it
   c. LLM fails/timeout/low-confidence? → fall through
9. Create or reuse thread
10. Create ThreadMessage
11. If still ambiguous, dispatch async Temporal workflow (existing, safety net)
```

### Dependencies

- No new packages needed.
- `@anthropic-ai/sdk` is already available in `apps/queue`. For inline LLM in `@shared/rest`, we need the API key available in the web app env. This is already present as `LLM_API_KEY` — just needs to be added to `@shared/env/web` if not already there.

---

## 3. Task Checklist

### Schema / Data

- [ ] Add `threadRecencyWindowMinutes` field to `WorkspaceAgentConfig` in Prisma schema (default 10) — `packages/database/prisma/`
- [ ] Run `npm run db:generate` + `npm run db:migrate` for the new field

### Backend / API

- [ ] **Widen candidate query** in `performIngestion()` (intake.ts:145-162) — change `customerId: customer.id` to workspace-wide (`workspaceId + source + status != CLOSED`), increase `take` from 10 to 20
- [ ] Also widen candidate query in `getInboxThreadResolutionCandidates` (resolve-inbox-thread.activity.ts:13-28) — remove `customerId` filter for consistency
- [ ] Add `time_proximity` to `MatchStrategy` union in `packages/rest/src/routers/helpers/thread-matching.ts`
- [ ] Add `customerId` field to `ThreadMatchCandidate` interface so time-proximity can filter same-customer candidates
- [ ] Implement time-proximity check in `decideDeterministicThreadMatch()` — after reply chain, before Jaccard. Accept `recencyWindowMs` and `customerId` params. Only match same-customer candidates within the time window. Pick most recent `lastInboundAt`.
- [ ] Update `DeterministicMatchInput` interface to include `recencyWindowMs: number` and `customerId: string`
- [ ] Extract LLM matching logic from `apps/queue/src/activities/llm-thread-match.activity.ts` into a shared util (`packages/rest/src/routers/helpers/llm-thread-match.ts`) that doesn't depend on Temporal or `queueEnv`
- [ ] Update `llmThreadMatchActivity` to call the shared util (avoid code duplication)
- [ ] Add inline LLM call in `performIngestion()` — after deterministic match fails, before thread creation. Wrap in 5s timeout with try/catch fallback.
- [ ] Add `LLM_API_KEY` and `LLM_MODEL_DEFAULT` to `@shared/env/web` if not already present
- [ ] Pass `threadRecencyWindowMinutes` from `WorkspaceAgentConfig` into `performIngestion` (fetch once at start of transaction)

### Frontend / UI

- [ ] (Low priority) Add recency window input to workspace agent settings page

### Wiring

- [ ] Ensure `@shared/rest` can import `@anthropic-ai/sdk` — add to `packages/rest/package.json` dependencies
- [ ] Update `packages/rest/src/routers/helpers/thread-matching.ts` exports for new strategy

### Cleanup

- [ ] Update unit tests in `thread-matching.unit.test.ts` — add time-proximity test cases
- [ ] Update e2e tests in `thread-matching.e2e.test.ts` if they exist
- [ ] Keep async Temporal workflow as safety net (do NOT remove) — it handles edge cases where inline LLM times out

---

## 4. Testing Checklist

### Happy Path

- [ ] 4 rapid-fire messages from same customer within 10 min all land on the same `SupportThread`
- [ ] User A reports "trash code on settings page", User B sends "i need to fix this" → both land on same thread (cross-customer, same issue)
- [ ] Message sent 15 min after last activity creates a new thread (outside recency window, no semantic match)
- [ ] Message with explicit `externalThreadId` still matches by external ID (strategy 1 unchanged)
- [ ] Reply chain matching still works (strategy 2 unchanged)
- [ ] High Jaccard overlap still matches (strategy 4 unchanged)

### Workspace-Wide Candidates

- [ ] Candidate query returns threads from ALL customers in the workspace (not just sender)
- [ ] Candidate query is scoped by `workspaceId + source + status != CLOSED`
- [ ] At most 20 candidates returned, ordered by `lastMessageAt desc`

### Time-Proximity Strategy

- [ ] Same customer, `lastInboundAt` within 10 min → matches most-recent same-customer thread with confidence 0.92
- [ ] Different customer within 10 min → time-proximity does NOT match (cross-customer matching handled by Jaccard/LLM instead)
- [ ] `lastInboundAt` within 10 min but `externalThreadId` explicitly provided → skips time-proximity
- [ ] Multiple open threads from same customer → picks the one with most recent `lastInboundAt`
- [ ] Only CLOSED threads within window → does NOT match (closed threads are excluded)
- [ ] Custom `threadRecencyWindowMinutes` (e.g., 5 min) is respected

### Inline LLM

- [ ] When deterministic fails + candidates exist → LLM called inline, correct thread matched
- [ ] LLM timeout (>5s) → falls through to new thread + async workflow dispatched
- [ ] LLM returns confidence < 0.85 → falls through to new thread
- [ ] LLM API key not set → falls through gracefully (no crash)
- [ ] LLM returns `matchedThreadId` that doesn't exist in candidates → treated as no match

### Edge Cases

- [ ] First-ever message in workspace → no candidates, no time-proximity → creates new thread
- [ ] Same user sends message to two different workspaces within 10 min → separate threads (scoped by workspaceId)
- [ ] 3 different users report same issue → all 3 messages land on one thread via Jaccard or inline LLM
- [ ] Empty message body → fingerprint is empty, time-proximity still works for same customer
- [ ] Concurrent ingestion of two messages at the same millisecond → no duplicate threads (transaction isolation)
- [ ] Workspace with 50+ open threads → candidate query capped at 20, LLM prompt stays bounded

### Validation

- [ ] `threadRecencyWindowMinutes` ≤ 0 → treated as time-proximity disabled
- [ ] `threadRecencyWindowMinutes` > 1440 (24h) → capped or rejected

### Type Safety

- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds
- [ ] `npm run build --workspace @app/queue` succeeds (queue still compiles with refactored LLM util)

### Regression

- [ ] Existing unit tests in `thread-matching.unit.test.ts` still pass
- [ ] Existing e2e tests still pass
- [ ] Async Temporal workflow still fires as safety net when inline LLM times out
