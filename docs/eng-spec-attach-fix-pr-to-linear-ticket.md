# Engineering Spec: Attach Fix PR to Linear Ticket

## 1. Job to Be Done

- **Who**: Support engineers and workspace admins using the triage + fix-PR pipeline.
- **What**: When the fix-PR workflow creates a GitHub PR, automatically attach the PR URL to the associated Linear ticket — so the Linear issue has a direct link to the code fix without any manual copy-paste.
- **Why**: Today, `triageToLinear` creates a Linear ticket and `generateFixPR` opens a GitHub PR, but these two outputs are disconnected. The engineer has to manually find the PR URL in the inbox UI and paste it into Linear. This is friction that breaks the "customer symptom → triage → code fix" automation promise.
- **Success criteria**:
  - When a fix-PR run reaches a terminal status (`PASSED` or `WAITING_REVIEW`) with a `prUrl`, and the thread has a `linearIssueId`, the Linear ticket description is automatically updated to include the PR link.
  - The update appears as a new section in the Linear issue body (e.g., `## Fix PR`) — it does not overwrite existing content.
  - If no Linear ticket exists for the thread, the step is skipped gracefully (no error).
  - The `TriageAction` audit log records that the Linear ticket was updated with the PR link.
  - The triage history in the inbox UI shows the "PR linked to Linear" action.

---

## 2. Proposed Flow / Architecture

### 2.1 Data Model Changes

**None required.** All necessary fields already exist:

- `SupportThread.linearIssueId` / `linearIssueUrl` — tracks the linked Linear issue.
- `TriageAction.prUrl` — stores the GitHub PR URL from fix-PR runs.
- `TriageAction.linearIssueId` / `linearIssueUrl` — can record the Linear update action.
- `WorkspaceAgentConfig.linearApiKey` / `linearTeamId` — workspace Linear credentials.

### 2.2 API Layer

**Extend `linear-client.ts`** with a helper to append a PR section to an existing issue:

```ts
export async function appendPRToLinearIssue(
  client: LinearClient,
  issueId: string,
  prUrl: string,
  prTitle?: string,
): Promise<{ success: boolean; issueUrl?: string }>
```

This function:
1. Fetches the current issue description via `getLinearIssue()`.
2. Appends a `## Fix PR` section with the PR link (markdown format).
3. Calls `updateLinearIssue()` with the updated description.
4. Returns success status + issue URL.

**No new tRPC procedures needed.** The linkage happens inside the existing `saveFixPRProgress` flow (server-side), not triggered by a separate user action.

### 2.3 Integration Point

The attachment logic hooks into `createTerminalFixPrTriageAction()` in `packages/rest/src/routers/agent.ts` (lines 275-320). When a terminal fix-PR status is saved:

1. Check if `prUrl` is present and status is `PASSED` or `WAITING_REVIEW`.
2. Look up `SupportThread.linearIssueId` for the thread.
3. If a Linear issue exists, look up `WorkspaceAgentConfig.linearApiKey`.
4. If Linear is configured, call `appendPRToLinearIssue()`.
5. Create an additional `TriageAction` with `action: UPDATE_TICKET` recording the Linear update.

### 2.4 Alternative: Queue Activity (Recommended)

Since `saveFixPRProgress` is called from the Codex queue worker via REST, and the Linear API call adds latency, the cleaner approach is to make the Linear update a **new activity** in the fix-PR workflow itself, called after the final `saveFixRunProgress` activity.

```
Workflow terminal step:
  saveFixRunProgress (existing)
    │
    └─ attachPRToLinearTicket (NEW activity)
         - fetch thread.linearIssueId
         - fetch workspace linearApiKey
         - if both exist: append PR link to Linear issue
         - save TriageAction (UPDATE_TICKET)
```

This keeps the REST endpoint fast and lets Temporal handle retries on Linear API failures.

### 2.5 Flow Diagram

```
1. Fix-PR workflow reaches terminal status (PASSED or WAITING_REVIEW)
2. Workflow calls saveFixRunProgress activity (existing)
3. Workflow calls attachPRToLinearTicket activity (NEW):
   a. GET thread → check linearIssueId exists
   b. GET workspace agent config → check linearApiKey exists
   c. If both present:
      - Fetch current Linear issue description
      - Append "## Fix PR\n[PR #N](url) — status" section
      - Update Linear issue via API
      - POST /api/rest/fix-pr/link-linear with { threadId, linearIssueId, prUrl }
      - Web creates TriageAction (UPDATE_TICKET) with linearIssueId + prUrl
   d. If either missing: skip gracefully, log reason
4. UI polling picks up the new TriageAction in triage history
```

### 2.6 Linear Issue Description Format

Append to the existing description (never overwrite):

```markdown

---

## Fix PR

| Status | PR |
|--------|-----|
| PASSED | [#42 — fix: handle null discount](https://github.com/org/repo/pull/42) |

*Auto-linked by ResolveAI fix-PR pipeline*
```

If the issue already has a `## Fix PR` section (from a previous run), replace that section instead of duplicating.

### 2.7 Frontend

No new UI components needed. The existing triage history rendering in `TriageSection.tsx` already handles `UPDATE_TICKET` actions with `linearIssueUrl`. The new action will show as "Updated Linear ticket" with the issue link — same visual pattern as when `triageToLinear` updates an existing ticket.

### 2.8 Dependencies

No new packages. Uses existing `@linear/sdk` via `linear-client.ts`.

### 2.9 New Files

| File | Purpose |
|------|---------|
| `apps/codex/src/activities/generate-fix-pr.activity.ts` | Add `attachPRToLinearTicketActivity` function (extend existing file) |
| `apps/web/src/app/api/rest/fix-pr/link-linear/route.ts` | REST endpoint for queue → web Linear link persistence |

---

## 3. Task Checklist

### Backend — Linear Client

- [ ] Add `appendPRToLinearIssue()` to `packages/rest/src/routers/helpers/linear-client.ts` — fetches current description, appends/replaces `## Fix PR` section, calls update

### Backend — REST Endpoint

- [ ] Create `apps/web/src/app/api/rest/fix-pr/link-linear/route.ts` — POST handler that creates `TriageAction` with `action: UPDATE_TICKET`, validates `x-internal-secret`

### Shared Types

- [ ] Add `AttachPRToLinearSchema` Zod schema in `packages/types/src/schemas/index.ts` with `{ threadId, workspaceId, analysisId, linearIssueId, linearIssueUrl, prUrl, prNumber }`

### Codex — Activity + Workflow

- [ ] Add `attachPRToLinearTicketActivity` in `apps/codex/src/activities/generate-fix-pr.activity.ts` — fetches thread + workspace config, calls `appendPRToLinearIssue`, then POSTs to link-linear endpoint
- [ ] Export new activity from `apps/codex/src/activities/index.ts`
- [ ] Update `apps/codex/src/workflows/generate-fix-pr.workflow.ts` — call `attachPRToLinearTicket` after `saveFixRunProgress` on terminal statuses `PASSED` or `WAITING_REVIEW`

### Wiring

- [ ] Register activity in Codex worker's activity list (if not auto-registered via index export)
- [ ] Rebuild codex worker: `npm run build --workspace @app/codex`

### Cleanup

- [ ] Verify `npm run type-check` passes
- [ ] Verify `npm run build` passes for web + codex
- [ ] Verify `npm run lint` passes

---

## 4. Testing Checklist

### Happy Path

- [ ] Fix-PR run completes as `PASSED` with `prUrl`, thread has `linearIssueId` → Linear issue description is updated with PR link section
- [ ] Fix-PR run completes as `WAITING_REVIEW` with `prUrl`, thread has `linearIssueId` → Linear issue description is updated
- [ ] `TriageAction` with `action: UPDATE_TICKET` is created with both `linearIssueId` and `prUrl` populated
- [ ] Triage history in inbox UI shows "Updated Linear ticket" entry with issue link

### Validation

- [ ] Thread has no `linearIssueId` → activity skips gracefully, no error, no `TriageAction` created
- [ ] Workspace has no `linearApiKey` configured → activity skips gracefully
- [ ] Fix-PR run completes as `FAILED` or `CANCELLED` → activity is not called (no Linear update for failed runs)
- [ ] `x-internal-secret` validation on `/api/rest/fix-pr/link-linear` rejects unauthorized requests

### Edge Cases

- [ ] Linear issue was deleted after triage but before fix-PR completes → `getLinearIssue` returns null, activity skips with log
- [ ] Linear issue already has a `## Fix PR` section from a prior run → section is replaced, not duplicated
- [ ] Linear API rate limit / timeout → Temporal retries the activity (bounded retries)
- [ ] `prUrl` is null on terminal status (e.g., workflow failed before PR creation) → activity skips

### Auth / Permissions

- [ ] `linearApiKey` is never exposed to frontend (read from `WorkspaceAgentConfig` server-side only)
- [ ] REST endpoint validates `x-internal-secret` header

### Type Safety

- [ ] `npm run type-check` passes across all packages
- [ ] `npm run build` succeeds for `@app/web` and `@app/codex`

### Build

- [ ] Codex worker rebuilds successfully after adding new activity
- [ ] Activity is registered and callable from Temporal workflow
