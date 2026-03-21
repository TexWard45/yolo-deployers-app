# Engineering Spec: Fix Thread Matching for Follow-Up Messages After Bot Clarification

## 1. Job to Be Done

- **Who**: End customers interacting via Discord (or any channel) who receive a bot clarification and reply back in the same channel.
- **What**: When a customer replies after the bot asked a clarification question, the reply must be grouped into the **same** SupportThread — not create a duplicate.
- **Why**: Currently, if the customer doesn't use Discord's "Reply" feature and doesn't reply inside a Discord thread, the follow-up falls through all matching strategies (external_thread_id, reply_chain, time_proximity) and creates a new SupportThread. This fragments the conversation, breaks the AI analysis pipeline (which loses context), and creates a confusing inbox for support agents.
- **Success criteria**:
  - A customer message arriving after a bot clarification (thread status = `WAITING_CUSTOMER`) from the **same customer** is matched to the existing thread with high confidence.
  - No false positives: messages from **different** customers are not incorrectly grouped.
  - The fix works regardless of whether the customer uses Discord's reply feature or not.
  - The fix works for all channels (Discord bot, Discord webhook, in-app chat).

## 2. Root Cause Analysis

### Current matching waterfall (`decideDeterministicThreadMatch`)

```
1. external_thread_id  → 0.99  (Discord thread channel ID matches)
2. reply_chain          → 0.96  (inReplyToExternalMessageId lookup)
3. time_proximity       → 0.92  (any thread within recency window)
4. new_thread           → 0.00  (fallback — creates new thread)
```

### Why it fails for the reported scenario

**Timeline:**
- 10:17 AM — Customer sends "heyy i have error with setting page" in Discord channel
  - `externalThreadId = null` (channel message, not thread)
  - Creates SupportThread with `externalThreadId = "synthetic-discord-<uuid>"`
- 10:56 AM — Bot sends clarification via `sendDraftToChannel()`
  - Thread status updated to `WAITING_CUSTOMER`
  - `lastMessageAt` updated to 10:56 AM
  - If synthetic thread: Discord thread created from first message, `externalThreadId` updated to real thread channel ID
- 11:14 AM — Customer sends "ehlello" **in the main channel** (not inside the Discord thread)
  - `externalThreadId = null` (channel message) — **Step 1 fails**
  - `inReplyToExternalMessageId = null` (no Discord reply) — **Step 2 fails**
  - Time gap = 18 minutes, `DEFAULT_RECENCY_WINDOW_SECONDS = 50` — **Step 3 fails**
  - Falls through to `new_thread` — **duplicate created**

### The gap

There is no matching strategy for: "this customer has an open thread where we asked them a question and are waiting for their response." The `WAITING_CUSTOMER` status is a strong signal that the next inbound from that customer is a reply to the clarification.

## 3. Proposed Flow / Architecture

### Strategy: `awaiting_customer_response`

Add a new deterministic matching step between `reply_chain` and `time_proximity`:

```
1. external_thread_id        → 0.99
2. reply_chain               → 0.96
3. awaiting_customer_response → 0.95  ← NEW
4. time_proximity            → 0.92
5. new_thread                → 0.00
```

**Logic**: If the incoming message has no `externalThreadId` and no `inReplyToExternalMessageId`, check if there is a candidate thread where:
- `status = "WAITING_CUSTOMER"` — the bot sent a clarification/reply and is waiting
- `customerId` matches the current customer — same person we're waiting on
- Thread is not `CLOSED`

If exactly **one** such thread exists, match to it (confidence 0.95). If **multiple** exist, pick the one with the most recent `lastOutboundAt` (most recently asked question). This is safe because:
- The `WAITING_CUSTOMER` status is only set by `sendDraftToChannel()` after actually sending a reply
- The customer constraint prevents cross-customer false matches
- The status naturally clears when the next inbound arrives (performIngestion resets to `WAITING_REVIEW`)

### Data model changes

**None.** The `SupportThread` model already has:
- `status` field with `WAITING_CUSTOMER` enum value
- `customerId` field
- `lastOutboundAt` timestamp

The `ThreadMatchCandidate` interface in `thread-matching.ts` needs a new field: `status`.

### API layer changes

**None.** No new endpoints or schemas needed. The change is purely in the matching logic within `performIngestion()` + `decideDeterministicThreadMatch()`.

### Files to modify

| File | Change |
|------|--------|
| `packages/rest/src/routers/helpers/thread-matching.ts` | Add `status` to `ThreadMatchCandidate`, add `awaiting_customer_response` to `MatchStrategy`, add matching logic in `decideDeterministicThreadMatch()` |
| `packages/rest/src/routers/intake.ts` | Add `status` to the `candidateThreads` select, add `lastOutboundAt` to candidate select |

### Flow diagram

```
Inbound message arrives (no externalThreadId, no inReplyTo)
  │
  ├─ Step 1: external_thread_id? → NO
  ├─ Step 2: reply_chain?        → NO
  │
  ├─ Step 3 (NEW): awaiting_customer_response?
  │   ├─ Filter candidates: status = WAITING_CUSTOMER AND customerId = sender
  │   ├─ 0 matches → skip to step 4
  │   ├─ 1 match  → return (threadId, confidence: 0.95, strategy: "awaiting_customer_response")
  │   └─ N matches → pick most recent lastOutboundAt → return match
  │
  ├─ Step 4: time_proximity?     → check recency window
  └─ Step 5: new_thread          → create new
```

### Dependencies

None. No new packages, env vars, or external services.

## 4. Task Checklist

### Backend / Matching Logic

- [ ] Add `"awaiting_customer_response"` to `MatchStrategy` type in `thread-matching.ts`
- [ ] Add `status` and `lastOutboundAt` fields to `ThreadMatchCandidate` interface in `thread-matching.ts`
- [ ] Add `awaiting_customer_response` matching step in `decideDeterministicThreadMatch()` between reply_chain and time_proximity — filter candidates by `status === "WAITING_CUSTOMER"` AND `customerId === input.customerId`, pick most recent `lastOutboundAt` if multiple
- [ ] Update `candidateThreads` query in `performIngestion()` (`intake.ts`) to include `status` and `lastOutboundAt` in the `select` clause
- [ ] Mark `awaiting_customer_response` matches as `needsReview: false` (high confidence, no async review needed)

### Cleanup

- [ ] Update the matching waterfall comment/JSDoc in `decideDeterministicThreadMatch()` to document the new step
- [ ] Update CLAUDE.md "Thread Matching Rules" section to include the new strategy

## 5. Testing Checklist

### Happy path

- [ ] Customer sends message → bot sends clarification (thread status = WAITING_CUSTOMER) → customer sends follow-up without Discord reply → follow-up matches existing thread via `awaiting_customer_response` strategy
- [ ] Matched thread status resets to `WAITING_REVIEW` after ingestion (existing behavior in `performIngestion`)
- [ ] AI analysis pipeline re-triggers on the matched thread (existing behavior)

### Edge cases

- [ ] Customer has **no** WAITING_CUSTOMER threads → falls through to time_proximity or new_thread (no change)
- [ ] Customer has **multiple** WAITING_CUSTOMER threads → matches the one with most recent `lastOutboundAt`
- [ ] **Different** customer sends a message while thread is WAITING_CUSTOMER → does NOT match (customerId filter)
- [ ] Thread status is WAITING_CUSTOMER but thread is `CLOSED` → does NOT match (existing `status: { not: "CLOSED" }` filter on candidate query)
- [ ] Message arrives WITH `externalThreadId` (inside Discord thread) → matched by `external_thread_id` strategy first, never reaches `awaiting_customer_response`
- [ ] Message arrives WITH `inReplyToExternalMessageId` → matched by `reply_chain` strategy first
- [ ] Thread was WAITING_CUSTOMER but another message already arrived and reset it to WAITING_REVIEW → `awaiting_customer_response` doesn't fire, falls through to time_proximity or new_thread

### Type safety & build

- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds
- [ ] `npm run build --workspace @app/queue` succeeds (queue imports thread-matching types)
