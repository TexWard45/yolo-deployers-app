# Eng Spec: Group First, Eject Later — Thread Matching v3

## 1. Job to Be Done

- **Who**: Support agents using the inbox; end-users sending messages via Discord or in-app chat.
- **What**: Messages from the same customer arriving close together should be grouped into one thread instantly. After a quiet period, a background workflow reviews the thread and ejects any messages that belong to a different issue.
- **Why**: The current approach tries to semantically match each individual message on arrival. Vague messages like _"i need to fix this"_ or _"need fix"_ fail keyword matching (Jaccard = 0) and even inline LLM matching is unreliable on single short messages. The LLM works much better when it sees the **full batch** of recent messages together — it can understand context, spot topic shifts, and make confident decisions.
- **Success criteria**:
  1. Rapid-fire messages from the same customer always land on one thread instantly — zero latency, no LLM call needed at ingestion time.
  2. After a quiet period (configurable, default 2 min), a Temporal workflow reviews the thread's recent messages as a batch.
  3. The LLM correctly identifies messages about different topics and ejects them to new or existing threads.
  4. Single-topic rapid-fire conversations (the common case) are never disrupted — the workflow confirms they belong together and does nothing.
  5. No inline LLM call during ingestion — ingestion is fast and deterministic.

---

## 2. Proposed Flow / Architecture

### Mental Model

```
BEFORE (v2 — match each message):
  msg arrives → try keyword match → try LLM → create/assign thread
  Problem: vague messages fail, LLM sees 1 message in isolation

AFTER (v3 — group first, eject later):
  msg arrives → time-proximity groups into latest thread → done (fast)
  quiet period → workflow reviews batch → ejects mismatched messages
  Advantage: LLM sees ALL recent messages, can spot topic boundaries
```

### Ingestion Flow (synchronous, in `performIngestion`)

The ingestion path becomes simpler — no inline LLM, no Jaccard matching. Just deterministic strategies:

```
1. External thread ID match     → 0.99 (Discord thread, etc.)
2. Reply chain match            → 0.96 (inReplyToExternalMessageId)
3. Time-proximity (same customer) → 0.92 (within recency window)
4. New thread                   → fallback
```

**Removed from ingestion:**
- Jaccard fingerprint matching (unreliable for short messages)
- Inline LLM call (moved to async workflow where it has more context)
- `shouldEnqueueResolutionWorkflow` logic (replaced by debounced dispatch)

**Always dispatch workflow:** After every ingestion that used `time_proximity` or `new_thread`, dispatch the review workflow with a **debounce**. The workflow ID is keyed by `threadId` (not `messageId`), so multiple rapid messages hitting the same thread only trigger one workflow run.

### Review Workflow (async, Temporal)

The `resolveInboxThreadWorkflow` is reworked from "match one message to a thread" to "review a thread's recent messages and eject outliers."

**New flow:**

```
1. Wait for quiet period (Temporal timer, default 2 min) — debounce
2. Fetch the thread's recent messages (last N messages or last M minutes)
3. Fetch workspace-wide candidate threads (for ejection targets)
4. Call LLM with the FULL batch of messages + candidate threads
5. LLM returns: which messages (if any) should be ejected, and where
6. For each ejection: move message to target thread (existing or new)
7. Update thread summaries/fingerprints
```

**Debounce via Temporal:** Use the workflow ID `thread-review-{threadId}`. If a new message arrives while the workflow is waiting, the existing workflow is cancelled (via `WorkflowExecutionAlreadyStartedError` + terminate/cancel) and a new one starts, resetting the timer. This gives a natural debounce.

### New LLM Prompt (`thread-review.prompt.ts`)

Instead of classifying one message, the prompt reviews a batch:

```
Input:
  - Thread summary + fingerprint
  - All recent messages in the thread (ordered by time)
  - Candidate threads (workspace-wide, for potential merge targets)

Output:
  {
    "verdict": "keep_all" | "eject",
    "ejections": [
      {
        "messageId": "...",
        "reason": "...",
        "targetThreadId": "<existing-thread-id or null for new thread>"
      }
    ]
  }
```

The LLM sees the full conversation flow, so it can identify:
- "Messages 1-3 are about settings page bugs, message 4 is about billing → eject message 4"
- "All 4 messages are the same angry rant about settings → keep all"
- "Message 3 matches an existing thread about login issues → eject to that thread"

### Data Model Changes

No new models. One new field on `SupportThread`:

```prisma
model SupportThread {
  // existing fields...
  lastReviewedAt   DateTime?  // when the review workflow last ran
}
```

This prevents re-reviewing threads that haven't changed.

### API Layer Changes

- **No new tRPC routers.** Changes are internal to `performIngestion` and the Temporal workflow.
- **New Temporal dispatch function:** `dispatchThreadReviewWorkflow` in `packages/rest/src/temporal.ts` — keyed by `threadId` with cancel-and-restart semantics.

### Frontend Changes

None. The inbox UI already shows threads with their messages. Ejections are transparent — messages just move between threads.

### Dependencies

- No new packages.
- OpenAI SDK already in `@shared/rest`.
- `LLM_API_KEY` already in web + queue env.

---

## 3. Task Checklist

### Schema / Data

- [ ] Add `lastReviewedAt DateTime?` to `SupportThread` in Prisma schema
- [ ] Run `npm run db:generate` + `npm run db:push`

### Backend / API — Ingestion Simplification

- [ ] Simplify `decideDeterministicThreadMatch` — remove Jaccard fingerprint matching, keep only: external thread ID, reply chain, time-proximity, new_thread
- [ ] Remove inline LLM call from `performIngestion` — no more `llmThreadMatch` import in intake.ts
- [ ] Remove `shouldEnqueueResolutionWorkflow` — replace with: always dispatch review workflow when strategy is `time_proximity` or `new_thread`
- [ ] Add `dispatchThreadReviewWorkflow` to `packages/rest/src/temporal.ts` — workflow ID keyed by `threadId`, uses `WorkflowIdConflictPolicy.TERMINATE_EXISTING` for debounce
- [ ] Update `performIngestion` to call `dispatchThreadReviewWorkflow` instead of `dispatchResolveInboxThreadWorkflow`

### Backend / API — Review Workflow

- [ ] Create `thread-review.prompt.ts` in `packages/rest/src/routers/helpers/` — batch review prompt with GPT-4.1, returns `keep_all` or `eject` with message-level decisions
- [ ] Create `reviewThreadMessagesActivity` in `apps/queue/src/activities/` — fetches thread's recent messages + workspace candidate threads
- [ ] Create `applyThreadEjectionsActivity` in `apps/queue/src/activities/` — moves ejected messages to target threads (existing or new), updates summaries
- [ ] Rework `resolveInboxThreadWorkflow` — add Temporal timer (2 min debounce wait), then call review activity → LLM activity → apply ejections
- [ ] Register new activities in `apps/queue/src/activities/index.ts`
- [ ] Add `ThreadReviewWorkflowInput` and `ThreadReviewWorkflowResult` Zod schemas to `@shared/types`

### Wiring

- [ ] Update `packages/rest/src/index.ts` exports if needed
- [ ] Ensure `@shared/rest` `thread-review.prompt.ts` is importable from queue

### Cleanup

- [ ] Remove `llm_inline` from `MatchStrategy` union (no longer used at ingestion)
- [ ] Remove `LLM_INLINE_CONFIDENCE_THRESHOLD` from intake.ts
- [ ] Keep `llmThreadMatch` in `thread-match.prompt.ts` for now (async fallback still uses it) — can remove later once review workflow fully replaces it
- [ ] Update CLAUDE.md thread matching section
- [ ] Update unit tests for simplified deterministic matching
- [ ] Update e2e tests

---

## 4. Testing Checklist

### Happy Path

- [ ] 4 rapid-fire messages from same customer → all land on one thread via time-proximity (no LLM call)
- [ ] After 2 min quiet period, review workflow fires and confirms "keep_all" — no ejections
- [ ] User sends 3 messages about settings + 1 about billing → review workflow ejects billing message to new thread
- [ ] Ejected message lands on existing thread if one matches, otherwise creates new thread

### Debounce Behavior

- [ ] 3 messages 30s apart → only ONE workflow runs (after 2 min quiet after last message)
- [ ] Workflow in timer-wait phase gets cancelled when new message arrives → restarts timer
- [ ] Workflow ID `thread-review-{threadId}` prevents duplicate runs

### Review Prompt

- [ ] LLM returns `keep_all` for single-topic threads
- [ ] LLM returns `eject` with correct `messageId` for mixed-topic threads
- [ ] LLM returns `targetThreadId` pointing to existing thread when one matches
- [ ] LLM returns `targetThreadId: null` when ejected message is a new topic → new thread created
- [ ] LLM handles threads with 1 message → always `keep_all` (nothing to eject)

### Edge Cases

- [ ] First-ever message in workspace → new thread, no review needed (no candidates)
- [ ] Message with explicit `externalThreadId` → skips time-proximity, uses external ID
- [ ] Reply chain message → uses reply chain strategy, review still fires
- [ ] Thread marked CLOSED → not included as candidate for ejection targets
- [ ] Empty message body → handled gracefully
- [ ] LLM timeout → review workflow returns without ejecting (safe default)
- [ ] Ejection target thread deleted between LLM response and apply → skip that ejection

### Regression

- [ ] External thread ID matching still works unchanged
- [ ] Reply chain matching still works unchanged
- [ ] Time-proximity matching still works unchanged
- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds
- [ ] Unit tests pass
- [ ] Async Temporal workflow safety net still works
