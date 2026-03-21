# How AI Thread Analysis Works

## Overview

When a customer sends a message, the AI automatically investigates the issue and drafts a reply. The pipeline runs as a Temporal workflow triggered after each inbound message.

## The Full Flow

```
Customer sends message (Discord / API / in-app)
        │
        ▼
  performIngestion()
  ├── upsert customer
  ├── match/create thread
  ├── create message
  ├── dispatch threadReviewWorkflow (existing — checks thread grouping)
  └── dispatch analyzeThreadWorkflow ◄── NEW (if AI enabled)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                  analyzeThreadWorkflow                       │
│                                                             │
│  1. DEBOUNCE (30 seconds)                                   │
│     Workflow ID is `analyze-thread-{threadId}`.             │
│     If 5 messages arrive in 10s, only ONE workflow runs.    │
│     Second/third dispatches are silently skipped.           │
│     After 30s, the workflow reads ALL messages at once.     │
│                                                             │
│  2. FETCH CONTEXT                                           │
│     Activity reads from DB:                                 │
│     - Last 20 messages (all directions, oldest first)       │
│     - Customer display name                                 │
│     - WorkspaceAgentConfig (full record)                    │
│     - Thread's clarificationCount + issueFingerprint        │
│     Returns null → skip if:                                 │
│       - agent disabled                                      │
│       - analysisEnabled = false                             │
│       - thread is CLOSED                                    │
│       - no inbound messages                                 │
│                                                             │
│  3. SUFFICIENCY CHECK (GPT-4.1, 15s timeout)                │
│     LLM reads all messages and evaluates:                   │
│     ┌─────────────────────────────────────────────┐         │
│     │ Issue type  │ What's needed for "sufficient" │         │
│     │─────────────│────────────────────────────────│         │
│     │ Bug         │ 2+ of: error msg, repro steps, │         │
│     │             │ affected feature, environment   │         │
│     │ Feature req │ What they want + why           │         │
│     │ How-to      │ Clear question                 │         │
│     │ Account     │ Account ID + what went wrong   │         │
│     └─────────────────────────────────────────────┘         │
│     Returns: { sufficient: bool, missingContext: string[] } │
│                                                             │
│     IF INSUFFICIENT:                                        │
│     ├── clarificationCount >= maxClarifications (default 2) │
│     │   → escalate thread to ESCALATED status → done        │
│     └── else → generate CLARIFICATION draft                 │
│         LLM writes max 3 targeted questions about           │
│         what's missing → save → done                        │
│                                                             │
│     IF SUFFICIENT: continue ▼                               │
│                                                             │
│  4. PARALLEL INVESTIGATION                                  │
│     ┌──────────────────┐  ┌──────────────────────┐         │
│     │  Codex Search     │  │  Sentry Lookup       │         │
│     │                  │  │                      │         │
│     │  IF configured:  │  │  MVP: returns []     │         │
│     │  - Takes last 3  │  │  Phase 2 will call   │         │
│     │    messages +    │  │  Sentry Web API to   │         │
│     │    fingerprint   │  │  search for matching │         │
│     │  - Builds query  │  │  errors by signals   │         │
│     │  - POST /codex/  │  │  extracted from      │         │
│     │    search        │  │  messages (error     │         │
│     │  - Hybrid: embed │  │  msgs, stack traces, │         │
│     │    + keyword +   │  │  Sentry URLs, HTTP   │         │
│     │    symbol search │  │  status codes)       │         │
│     │  - Returns top 5 │  │                      │         │
│     │    code chunks   │  │                      │         │
│     │                  │  │                      │         │
│     │  IF not config:  │  │                      │         │
│     │  → null (skip)   │  │                      │         │
│     └──────────────────┘  └──────────────────────┘         │
│                                                             │
│  5. GENERATE ANALYSIS (GPT-4.1, 25s timeout)                │
│     LLM receives: messages + Codex chunks + Sentry errors   │
│     Produces:                                               │
│     - issueCategory: bug/feature_request/how_to/etc         │
│     - severity: critical/high/medium/low                    │
│     - affectedComponent: "auth", "billing page", etc        │
│     - summary: 1-3 sentence engineering description         │
│     - rcaSummary: root cause connecting symptoms → code     │
│                                                             │
│  6. GENERATE RESOLUTION DRAFT (GPT-4.1, 15s timeout)        │
│     Takes analysis + agent config (tone, systemPrompt)       │
│     Writes customer-facing reply. Never mentions internal    │
│     tools or code paths to the customer.                     │
│                                                             │
│  7. SAVE                                                    │
│     POST /api/rest/analysis/save                             │
│     Creates: ThreadAnalysis + ReplyDraft (type: RESOLUTION)  │
│     Updates: SupportThread.lastAnalysisId                    │
│     Human sees draft in Analysis Panel → approves/dismisses  │
└─────────────────────────────────────────────────────────────┘
```

## What Data Sources Feed Each Step

| Step | Input | Source |
|------|-------|--------|
| Sufficiency check | Chat messages (up to 20) | DB: `ThreadMessage` |
| Codex search | Last 3 messages + issueFingerprint | REST: `/api/rest/codex/search` → embedded code chunks |
| Sentry lookup | Error signals from messages | Sentry Web API (MVP: stubbed) |
| Analysis | Messages + code chunks + Sentry errors | All of the above combined |
| Draft | Analysis result + agent config | `ThreadAnalysis` + `WorkspaceAgentConfig` |

## Sufficiency Assessment — In Detail

The sufficiency check is **purely LLM-based**. It does NOT:
- Search the codebase first
- Check embeddings or vector similarity
- Do any deterministic keyword analysis

It sends all thread messages to GPT-4.1 with a structured decision framework prompt. The LLM evaluates based on issue type rules (bugs need error messages + repro steps, etc.) and returns:

```json
{
  "sufficient": false,
  "missingContext": ["error message or screenshot", "which page this happens on"],
  "confidence": 0.85,
  "reasoning": "Customer reports something is broken but doesn't specify which feature or provide error details"
}
```

The `missingContext` array is then fed into the clarification draft prompt, which writes targeted questions asking for exactly those things.

**Why LLM-only?** For MVP, this is pragmatic. The LLM is good at reading conversational messages and judging clarity. A smarter version could pre-search Codex to check if the issue is findable, or compare against past resolved threads.

## Codex Search — How It Queries the Codebase

When the workspace has `codexRepositoryIds` configured, the activity:

1. Takes the **last 3 message bodies** + the thread's **issueFingerprint** (extracted keywords)
2. Joins them into a single query string (max 500 chars)
3. Calls `POST /api/rest/codex/search` with:
   - `repositoryIds`: only search configured repos
   - `channels`: semantic (vector embeddings) + keyword (full-text) + symbol (function names)
   - `limit: 5`: top 5 most relevant code chunks
4. The search uses **Reciprocal Rank Fusion** (RRF) to merge results from all 3 channels
5. Returns code chunks with: file path, symbol name, content snippet, relevance score

The analysis LLM then receives these chunks and can cite specific files/functions in the RCA.

## Configuration

All settings are per-workspace on `WorkspaceAgentConfig`:

| Field | Default | Purpose |
|-------|---------|---------|
| `enabled` | `false` | Master switch for all AI features |
| `analysisEnabled` | `true` | Toggle analysis pipeline specifically |
| `autoDraftOnInbound` | `true` | Auto-trigger on inbound messages |
| `maxClarifications` | `2` | Max auto-clarifications before escalating |
| `codexRepositoryIds` | `[]` | Which repos to search for RCA |
| `tone` | `null` | Brand voice for drafts ("friendly", "formal", etc.) |
| `systemPrompt` | `null` | Custom instructions injected into draft prompt |
| `model` | `null` | LLM model override (default: gpt-4.1) |
| `sentryDsn` | `null` | Sentry DSN (Phase 2) |
| `sentryOrgSlug` | `null` | Sentry org (Phase 2) |
| `sentryProjectSlug` | `null` | Sentry project (Phase 2) |
| `sentryAuthToken` | `null` | Sentry auth token (Phase 2, redacted in API) |

## Example Scenarios

### Scenario 1: Vague message
**Customer:** "it's broken"
1. Sufficiency check → INSUFFICIENT, missing: ["which feature is affected", "error message or screenshot"]
2. Clarification draft: "Hi! I'd like to help — could you tell me which feature you're having trouble with? If you're seeing an error message, a screenshot would be really helpful."
3. Saved as `ReplyDraft(draftType: CLARIFICATION)`

### Scenario 2: Clear bug report
**Customer:** "Login page shows a 500 error when I click the submit button on Chrome. Started happening today."
1. Sufficiency check → SUFFICIENT (has: error code, affected feature, action, environment)
2. Codex search: queries "login page 500 error submit button" → finds `auth/login.ts`, `LoginForm.tsx`
3. Analysis: `{ category: "bug", severity: "high", component: "authentication", summary: "Login form submit returns HTTP 500...", rcaSummary: "The login handler in auth/login.ts may be failing on..." }`
4. Resolution draft: "We've identified an issue with the login form. Our team is investigating the authentication service. As a workaround..."
5. Saved as `ReplyDraft(draftType: RESOLUTION)` + `ThreadAnalysis`

### Scenario 3: Repeated clarifications with no response
1. First clarification → customer replies "yeah fix it"
2. Second clarification → customer replies "still broken"
3. `clarificationCount` (2) >= `maxClarifications` (2) → thread escalated to `ESCALATED` status
4. Human support agent takes over

## Outbound Send Pipeline

When a human approves a draft, the message is sent directly to the customer's channel from the web app — no Temporal workflow needed.

```
Human clicks "Send" on draft in chat UI
    │
    ▼
approveDraft tRPC mutation (packages/rest/src/routers/agent.ts)
    │
    ├── 1. Validate draft status is GENERATED
    │
    ├── 2. Send to external channel (DISCORD)
    │   │
    │   ├── Thread has real Discord thread ID (externalThreadId is a snowflake)?
    │   │   └── POST /channels/{externalThreadId}/messages
    │   │       → Send directly into existing Discord thread
    │   │
    │   └── Thread has synthetic ID (externalThreadId starts with "synthetic-")?
    │       ├── Read channelId from first inbound message metadata
    │       ├── POST /channels/{channelId}/messages/{messageId}/threads
    │       │   → Create Discord thread under customer's first message
    │       ├── POST /channels/{newThreadId}/messages
    │       │   → Send reply inside new thread
    │       └── Update SupportThread.externalThreadId = newThreadId
    │           (future replies go directly into same thread)
    │
    ├── 3. Create OUTBOUND ThreadMessage in DB
    │
    ├── 4. Update thread: status → WAITING_CUSTOMER, timestamps
    │
    └── 5. Draft status → SENT
```

**How Discord routing works:**
- `channelId` is stored on each inbound message's `metadata` (top-level, set by Discord bot during ingestion)
- `externalThreadId` on `SupportThread` starts as `synthetic-{uuid}` (no Discord thread yet) or a real Discord snowflake (thread already exists)
- When a synthetic thread gets its first outbound reply, the mutation creates a Discord thread under the customer's original message and updates `externalThreadId` to the real thread ID
- Subsequent replies go directly into the existing Discord thread
- Uses `DISCORD_BOT_TOKEN` env var (same token the bot uses for listening)

**Files:**
- `packages/rest/src/routers/agent.ts` — `approveDraft` mutation handles send + DB writes
- `apps/web/src/actions/inbox.ts` — `approveDraftAction` server action (calls tRPC)
- `apps/web/src/components/inbox/AnalysisPanel.tsx` — `DraftChatBubble` UI component

## Draft Reply UI

The AI draft reply is shown as a chat-style suggestion in the main conversation area, between the message list and the reply bar.

```
┌──────────────────────────────────────────┐
│  Thread 1                      1 msgs    │
│    D  Customer Name  5m ago              │
│    │  "heyy i have error with..."        │
│    │                                     │
│    └── T  Team  just now                 │
│        "Hi, thanks for reaching out..."  │
├──────────────────────────────────────────┤
│  AI  DRAFT REPLY  [Clarification]        │  ◄── DraftChatBubble
│  ┌────────────────────────────────────┐  │      (violet-tinted strip)
│  │ Hi, could you tell me which page  │  │
│  │ you're seeing the error on?       │  │
│  └────────────────────────────────────┘  │
│  [Send]  [Edit]  [Delete]                │
├──────────────────────────────────────────┤
│  Reply to Thread 1                       │  ◄── Manual reply bar
│  [Write a reply...              ] [Send] │
└──────────────────────────────────────────┘
```

**How it works:**
1. `AnalysisPanel` (sidebar) fetches the latest analysis via `getLatestAnalysis` tRPC query
2. When analysis includes a draft with status `GENERATED`, it calls `onDraftAvailable(draft)` callback
3. `ThreadDetailSheet` receives the draft and renders `DraftChatBubble` above the reply bar
4. User actions on the draft:
   - **Send** → calls `approveDraftAction` → sends to Discord + saves outbound message → refreshes thread
   - **Edit** → toggles inline textarea for modifying draft body before sending
   - **Delete** → calls `dismissDraftAction` → sets draft status to `DISMISSED`
5. After send/delete, the bubble disappears and the thread messages refresh

**Analysis sidebar** (right panel) still shows: classification badges, severity, summary, RCA, and Codex findings — but no longer shows the draft itself.

## Thread Message Tree View

Messages within each thread segment are displayed in a tree layout:

- **Root message** (first in segment): full width, with a vertical connector line if replies exist
- **Reply messages**: indented with `ml-8`, connected by vertical + horizontal branch lines
- Tree lines are rendered with absolute-positioned `div` elements using `bg-border` color

## Sentry Integration (Phase 2 — Not Yet Implemented)

The plumbing is fully wired but `fetchSentryContext()` returns `[]`. When implementing:

1. Fill in `packages/rest/src/routers/helpers/sentry-client.ts`
   - `extractErrorSignals()` already works (regex extraction of error msgs, Sentry URLs, stack traces, HTTP codes)
   - Add: search Sentry issues via `GET /api/0/projects/{org}/{project}/issues/?query=...`
   - Add: get latest event via `GET /api/0/issues/{issueId}/events/latest/`
   - Extract: error type, message, stack trace frames, occurrence count
2. The activity (`fetchSentryErrorsActivity`) is already called in parallel with Codex search (workflow step 4)
3. Results flow into `generateAnalysisActivity` as `sentryFindings`
4. The analysis LLM prompt (`thread-analysis.prompt.ts`) already formats Sentry data in `buildUserMessage()`
5. Config (org, project, token) is per-workspace on `WorkspaceAgentConfig` — no global env vars

## Key Files

| File | Purpose |
|------|---------|
| `packages/rest/src/routers/helpers/sufficiency-check.prompt.ts` | Sufficiency LLM prompt |
| `packages/rest/src/routers/helpers/thread-analysis.prompt.ts` | Analysis + RCA LLM prompt |
| `packages/rest/src/routers/helpers/draft-reply.prompt.ts` | Draft reply LLM prompt |
| `packages/rest/src/routers/helpers/sentry-client.ts` | Sentry API client (MVP stub) |
| `packages/rest/src/routers/agent.ts` | tRPC: approveDraft (send), dismissDraft, getLatestAnalysis, triggerAnalysis, saveAnalysis |
| `packages/rest/src/temporal.ts` | dispatchAnalyzeThreadWorkflow() |
| `apps/queue/src/workflows/analyze-thread.workflow.ts` | Temporal workflow orchestration |
| `apps/queue/src/activities/analyze-thread.activity.ts` | All 8 activity functions |
| `apps/web/src/app/api/rest/analysis/save/route.ts` | REST endpoint for queue → web saves |
| `apps/web/src/actions/inbox.ts` | Server actions: approveDraftAction, dismissDraftAction |
| `apps/web/src/components/inbox/AnalysisPanel.tsx` | AI Analysis sidebar + DraftChatBubble component |
| `apps/web/src/components/inbox/ThreadDetailSheet.tsx` | Thread detail view with tree layout + draft suggestion area |
| `packages/database/prisma/support.schema.prisma` | ThreadAnalysis model, DraftType enum |
