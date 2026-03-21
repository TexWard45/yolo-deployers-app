# Engineering Spec: Auto-Reply Mode Toggle

## 1. Job to Be Done

- **Who:** Workspace admins configuring their AI support agent
- **What:** Toggle between two reply modes:
  - **Auto-reply** — AI generates a draft and immediately sends it to the customer (no human in the loop)
  - **Human-approval** (current default) — AI generates a draft shown as a suggestion; a human must click Send
- **Why:** Some teams want fully autonomous support for common questions (password resets, docs links), while others want human review before anything goes out. A single workspace-level toggle lets teams choose their comfort level.
- **Success criteria:**
  - When `autoReply = true`: after `analyzeThreadWorkflow` saves a draft, the reply is automatically sent to the customer's channel (Discord thread, etc.) and recorded as an outbound message — no human action needed
  - When `autoReply = false` (default): works exactly like today — draft appears in the chat UI as a suggestion with Send/Edit/Delete
  - The setting is configurable per workspace via the Settings page
  - Auto-sent messages are visually distinguishable from human-approved messages in the inbox UI

## 2. Proposed Flow / Architecture

### Data Model Changes

**Prisma schema** — add one field to `WorkspaceAgentConfig`:

```prisma
// In packages/database/prisma/support.schema.prisma
model WorkspaceAgentConfig {
  // ... existing fields ...

  // Reply mode
  autoReply          Boolean  @default(false)   // NEW: true = send immediately, false = wait for human
}
```

**Zod schema** — add to `UpdateWorkspaceAgentConfigSchema`:

```ts
// In packages/types/src/schemas/index.ts
autoReply: z.boolean().optional(),
```

### API Layer

No new tRPC procedures needed. Changes to existing:

1. **`agent.saveAnalysis`** (in `packages/rest/src/routers/agent.ts`) — after saving the draft, check workspace config. If `autoReply = true`, call the existing send-to-Discord logic (extracted from `approveDraft`) to auto-send.

2. **`agent.getWorkspaceConfig`** — already returns all config fields, just needs `autoReply` added to the default return object.

### Auto-Send Flow

```
analyzeThreadWorkflow completes
    │
    ▼
saveAnalysisAndDraftActivity
  → POST /api/rest/analysis/save
    → agent.saveAnalysis tRPC mutation
        │
        ├── Creates ThreadAnalysis + ReplyDraft (status: GENERATED)
        ├── Reads WorkspaceAgentConfig.autoReply
        │
        ├── autoReply = false (default)?
        │   └── Done. Draft appears in UI as suggestion.
        │
        └── autoReply = true?
            ├── Call sendDraftToChannel() helper (extracted from approveDraft)
            │   ├── Discord: create thread + send message
            │   ├── Record OUTBOUND ThreadMessage
            │   ├── Update thread status → WAITING_CUSTOMER
            │   └── Draft status → SENT
            └── Done. Message sent automatically.
```

### Frontend

**Settings page** — add a toggle to the workspace AI settings:

```
Reply Mode
  ○ Human approval (default) — AI drafts are shown as suggestions
  ● Auto-reply — AI sends replies automatically

  ⚠ When auto-reply is enabled, the AI will respond to customers
    without waiting for human review.
```

**Inbox UI** — auto-sent messages should show a small badge or label indicating they were auto-sent (e.g. "Auto-sent" tag on the outbound message).

### Dependencies

No new packages or env vars needed. Uses existing `DISCORD_BOT_TOKEN` and Discord send logic.

## 3. Task Checklist

### Schema / Data

- [ ] Add `autoReply Boolean @default(false)` to `WorkspaceAgentConfig` in `packages/database/prisma/support.schema.prisma`
- [ ] Run `npm run db:generate` to regenerate Prisma types
- [ ] Run `npm run db:push` or `npm run db:migrate` to apply schema
- [ ] Add `autoReply: z.boolean().optional()` to `UpdateWorkspaceAgentConfigSchema` in `packages/types/src/schemas/index.ts`

### Backend / API

- [ ] Extract Discord send logic from `approveDraft` into a reusable `sendDraftToChannel()` helper in `packages/rest/src/routers/helpers/send-draft.ts`
- [ ] Refactor `approveDraft` to call `sendDraftToChannel()` instead of inline Discord logic
- [ ] In `agent.saveAnalysis`, after saving draft: read `WorkspaceAgentConfig.autoReply`. If `true`, call `sendDraftToChannel()` with the newly created draft
- [ ] Add `autoReply: false` to the default config return in `agent.getWorkspaceConfig`
- [ ] Store `metadata.source = "ai-auto-reply"` (vs `"ai-draft-approved"`) on auto-sent outbound messages for auditability

### Frontend / UI

- [ ] Add auto-reply toggle to the workspace AI settings page (uses `agent.updateWorkspaceConfig` mutation)
- [ ] Show "Auto-sent" badge on outbound messages where `metadata.source === "ai-auto-reply"` in `ThreadDetailSheet`

### Cleanup

- [ ] Update `docs/how-ai-thread-analysis-works.md` with auto-reply flow
- [ ] Update `CLAUDE.md` AI Analysis Pipeline section with auto-reply design decision

## 4. Testing Checklist

### Happy Path

- [ ] With `autoReply = false` (default): draft appears as suggestion in chat UI, requires human click to send — existing behavior unchanged
- [ ] With `autoReply = true`: after analysis workflow completes, reply is automatically sent to Discord and appears as outbound message in inbox
- [ ] Auto-sent messages appear in Discord as a thread reply (same as human-approved sends)
- [ ] Toggle can be changed in Settings and takes effect on next inbound message

### Validation

- [ ] `autoReply` field accepts only boolean values via Zod schema
- [ ] Only OWNER/ADMIN can toggle the setting (existing `updateWorkspaceConfig` auth check)

### Edge Cases

- [ ] Auto-reply with `autoReply = true` but `DISCORD_BOT_TOKEN` missing — draft is saved but Discord send fails gracefully, logged as error
- [ ] Auto-reply on a thread with `synthetic-*` externalThreadId — creates Discord thread under first message then sends reply (same as manual flow)
- [ ] Clarification drafts auto-send when `autoReply = true` — customer gets the clarification questions automatically
- [ ] Escalated threads (max clarifications reached) — no auto-send, thread status set to ESCALATED
- [ ] Multiple rapid messages during debounce — only one analysis runs, only one auto-reply sent
- [ ] `saveAnalysis` called from queue via REST with `x-internal-secret` — auto-send still works (no userId needed)

### Auth / Permissions

- [ ] Non-admin users cannot toggle `autoReply` setting
- [ ] `saveAnalysis` REST endpoint auth via `x-internal-secret` remains unchanged

### Type Safety

- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds for both `@app/web` and `@app/queue`
