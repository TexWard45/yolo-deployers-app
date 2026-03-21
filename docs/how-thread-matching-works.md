# How Thread Matching Works

## Overview

When a customer sends a message (via Discord or in-app chat), the system decides which `SupportThread` it belongs to. The design follows a **"group first, eject later"** pattern:

1. **Ingestion** — fast, deterministic, no LLM. Groups messages by time proximity.
2. **Review** — async Temporal workflow. LLM reviews the thread as a batch and ejects mismatched messages.

## Ingestion Flow

When a message arrives at `performIngestion()` (`packages/rest/src/routers/intake.ts`):

```
1. Upsert Customer
2. Deduplicate by externalMessageId
3. Deterministic matching (no LLM):
   a. External thread ID  → confidence 0.99
   b. Reply chain          → confidence 0.96
   c. Time proximity       → confidence 0.92
   d. New thread           → fallback
4. Create/append ThreadMessage
5. Dispatch async review workflow (debounced)
```

### Strategy Details

| Strategy | When | Confidence |
|---|---|---|
| `external_thread_id` | Discord thread ID or explicit thread reference exists | 0.99 |
| `reply_chain` | Message has `inReplyToExternalMessageId` pointing to an existing message | 0.96 |
| `time_proximity` | Any open thread in the workspace had activity within the recency window | 0.92 |
| `new_thread` | No match found — creates a new thread | 0 |

### Time Proximity

The primary grouping mechanism. Any message arriving within **50 seconds** of the last activity on any open thread gets grouped into that thread.

- **Workspace-wide** — groups messages from ANY user, not just the same customer
- **Slides forward** — checks `lastMessageAt` (updated on every message), so the window extends with each new message
- **Configurable** — `WorkspaceAgentConfig.threadRecencyWindowMinutes` overrides the default (set to 0 to use the 50s default)

**Example:**
```
9:00:00  User A: "settings page is broken"     → Thread 1 (new)
9:00:15  User A: "need fix asap"               → Thread 1 (time proximity, 15s gap)
9:00:30  User B: "i see the same issue"         → Thread 1 (time proximity, 15s gap, different user)
9:02:00  User A: "also billing is wrong"        → Thread 2 (new, 90s gap > 50s window)
```

## Review Workflow

After ingestion, if the strategy was `time_proximity` or `new_thread`, a review workflow is dispatched.

### Debounce

- Workflow ID: `thread-review-{threadId}` — one per thread
- If a workflow already exists for the thread, the new dispatch is **skipped** (not terminated)
- The existing workflow will review all messages when its timer expires

### Flow

```
1. Sleep 2 minutes (quiet period)
2. Fetch thread's recent messages (up to 20)
3. Fetch workspace-wide candidate threads (for ejection targets)
4. Call GPT-4.1 to review the batch
5. LLM returns: "keep_all" or "eject" with per-message decisions
6. Apply ejections — move messages to target threads (existing or new)
```

### LLM Review Prompt

The prompt (`packages/rest/src/routers/helpers/thread-review.prompt.ts`) gives the LLM:

- All messages on the thread (ordered by time)
- Other open threads in the workspace (as ejection targets)

The LLM decides:
- **keep_all** — all messages belong together (common case)
- **eject** — some messages should move to a different thread

**Example:**
```
Messages: ["settings page is broken", "need fix asap", "also billing is wrong"]
Candidates: [Thread "billing-123": "billing invoice issues"]

LLM: {
  "verdict": "eject",
  "ejections": [{
    "messageId": "msg-3",
    "reason": "billing issue unrelated to settings page",
    "targetThreadId": "billing-123"
  }]
}
```

## File Map

| File | Purpose |
|---|---|
| `packages/rest/src/routers/helpers/thread-matching.ts` | Deterministic matching logic (pure functions) |
| `packages/rest/src/routers/helpers/thread-review.prompt.ts` | LLM batch review prompt (GPT-4.1, OpenAI) |
| `packages/rest/src/routers/helpers/thread-match.prompt.ts` | Legacy single-message LLM matcher (kept for reference) |
| `packages/rest/src/routers/intake.ts` | `performIngestion()` — orchestrates the full ingestion flow |
| `packages/rest/src/temporal.ts` | `dispatchThreadReviewWorkflow()` — Temporal dispatch with dedup |
| `apps/queue/src/activities/thread-review.activity.ts` | Review activities: fetch data, call LLM, apply ejections |
| `apps/queue/src/workflows/resolve-inbox-thread.workflow.ts` | Temporal workflow: sleep → review → eject |

## Configuration

| Setting | Location | Default | Description |
|---|---|---|---|
| `threadRecencyWindowMinutes` | `WorkspaceAgentConfig` | 0 (uses 50s) | Recency window override. Set 0 for 50s default. |
| `LLM_API_KEY` | env (`@shared/env/web` + `queue`) | — | OpenAI API key for GPT-4.1 |
| `QUIET_PERIOD_SECONDS` | `resolve-inbox-thread.workflow.ts` | 120 | How long to wait before running LLM review |

## Why This Design?

### Problem with per-message matching

The previous approach tried to semantically match each message on arrival:
- `"i need to fix this"` has zero keyword overlap with `"trash code on settings page"`
- LLM sees one isolated message — not enough context to match reliably
- Creates orphan threads that later get merged (bad UX)

### Why "group first, eject later" is better

- **Ingestion is instant** — no LLM call, pure time-based grouping
- **LLM sees full context** — reviews 4-5 messages together, can spot topic boundaries
- **Common case is fast** — most rapid-fire messages ARE about the same topic, no ejection needed
- **Splitting is more reliable than matching** — easier for LLM to say "message 4 doesn't belong" than to match a vague message to a thread
