# Engineering Spec: Remove Tracker Abstraction, Keep Triage Pipeline for Linear

## 1. Job to Be Done

- **Who**: Internal support engineers using the inbox to investigate and resolve threads.
- **What**: Remove the generic `TrackerConnection` abstraction and consolidate on the **triage pipeline** as the single path for creating Linear tickets. The triage pipeline (via `WorkspaceAgentConfig.linearApiKey/linearTeamId`) already creates rich, LLM-generated tickets with analysis context, severity mapping, and labels — the tracker abstraction's simple ticket creation is redundant and splits state.
- **Why**: Two parallel ticket-creation paths cause duplicate tickets, split state (`linearIssueId` vs `trackerIssueId`), and a confusing UI (ThreadCard shows `trackerIssueIdentifier` but TriageSection manages `linearIssueId`). The tracker abstraction was designed for future multi-provider support (JIRA, etc.) but adds premature complexity. The triage pipeline already works well for Linear — keep it simple.
- **Success criteria**:
  - `TrackerConnection` model, `tracker.*` tRPC routes, `TrackerService` interface, and `maybeCreateTrackerIssueForThread` are removed.
  - `trackerIssueId`/`trackerIssueIdentifier`/`trackerIssueUrl`/`trackerConnectionId` fields removed from `SupportThread`.
  - `linearIssueId`/`linearIssueUrl` on `SupportThread` + `linearApiKey`/`linearTeamId`/`linearDefaultLabels` on `WorkspaceAgentConfig` are the single source of truth.
  - ThreadCard badge uses `linearIssueId`/`linearIssueUrl` (from triage pipeline).
  - IN_PROGRESS status change no longer auto-creates tickets — tickets only come from triage pipeline (auto or manual).
  - Fix-PR pipeline references `linearIssueId` when generating PR descriptions.

---

## 2. Proposed Flow / Architecture

### 2.1 What Gets Removed

| File / Model | Action |
|---|---|
| `packages/database/prisma/tracker.schema.prisma` | Delete entire file (`TrackerConnection` model, `TrackerType` enum) |
| `packages/rest/src/lib/tracker/` | Delete entire directory (`index.ts`, `types.ts`, `linear.service.ts`, `linear.service.unit.test.ts`, `tracker.unit.test.ts`) |
| `packages/rest/src/routers/tracker.ts` | Delete (tRPC router: `tracker.list/create/update/delete/setDefault/listProjects`) |
| `apps/web/src/actions/tracker.ts` | Delete (server actions for tracker CRUD) |
| `apps/web/src/app/api/rest/tracker/` | Delete REST endpoints (if any) |
| `SupportThread.trackerIssueId/Identifier/Url/ConnectionId` | Remove from `thread.schema.prisma` |
| `Workspace.trackerConnections` | Remove relation from `workspace.schema.prisma` |
| `maybeCreateTrackerIssueForThread()` | Remove call from thread status-change handler |
| Tracker settings UI | Remove from workspace settings page |

### 2.2 What Stays (Triage Pipeline)

The existing triage pipeline is the sole path for ticket creation. No changes to its core logic:

```
supportPipelineWorkflow (auto)   OR   triageThreadWorkflow (manual click)
        │                                       │
        ▼                                       ▼
  Gate 2: linearApiKey + linearTeamId configured on WorkspaceAgentConfig?
        │ Yes
        ▼
  generateLinearIssueActivity (LLM → title + rich description)
        │
        ▼
  createOrUpdateLinearTicketActivity (Linear SDK via linear-client.ts)
        │
        ▼
  saveTriageResultActivity → SupportThread.linearIssueId/linearIssueUrl
                           → TriageAction audit log
```

**Credentials**: `WorkspaceAgentConfig.linearApiKey`, `linearTeamId`, `linearDefaultLabels` (already exist).

**Thread fields**: `SupportThread.linearIssueId` (unique), `linearIssueUrl` (already exist).

**TriageAction audit**: Already uses `linearIssueId`/`linearIssueUrl` — no change.

### 2.3 ThreadCard / ThreadList Updates

Currently ThreadCard receives `trackerIssueIdentifier`/`trackerIssueUrl` (from the Lu/Linear_integration branch). After removing tracker fields, switch to `linearIssueId`/`linearIssueUrl` from the triage pipeline.

The `linearIssueId` field stores the Linear identifier (e.g., "ENG-42") as set by `saveTriageResultActivity`. If it currently stores the UUID, update `saveTriageResultActivity` to store `identifier` (human-readable) there instead, or add a `linearIssueIdentifier` field.

### 2.4 Fix-PR Integration

`FixPrRun` already has `threadId`. When generating the PR:
- Read `SupportThread.linearIssueId` → include "Fixes ENG-42" in PR description.
- No tracker abstraction needed.

### 2.5 Settings UI

- Remove tracker connection management from workspace settings.
- Keep Linear config fields on agent settings form (`linearApiKey`, `linearTeamId`, `linearDefaultLabels`) — these already exist.

---

## 3. Task Checklist

### Schema / Data

- [ ] Remove `trackerIssueId`, `trackerIssueIdentifier`, `trackerIssueUrl`, `trackerConnectionId` from `SupportThread` in `thread.schema.prisma`
- [ ] Remove `trackerConnections TrackerConnection[]` from `Workspace` in `workspace.schema.prisma`
- [ ] Delete `packages/database/prisma/tracker.schema.prisma` entirely
- [ ] Create migration to drop tracker columns + `TrackerConnection` table
- [ ] Run `db:generate` + `db:migrate`

### Backend / API

- [ ] Delete `packages/rest/src/lib/tracker/` directory (index.ts, types.ts, linear.service.ts, tests)
- [ ] Delete `packages/rest/src/routers/tracker.ts` (tRPC router)
- [ ] Remove `tracker` router from `packages/rest/src/root.ts` (appRouter merge)
- [ ] Remove `maybeCreateTrackerIssueForThread()` call from thread status-change handler (in `packages/rest/src/routers/thread.ts` or wherever IN_PROGRESS triggers it)
- [ ] Remove tracker-related exports from `packages/rest/src/index.ts`
- [ ] Update `generate-fix-pr.activity.ts`: read `SupportThread.linearIssueId` and include in PR description

### Frontend / UI

- [ ] Delete `apps/web/src/actions/tracker.ts`
- [ ] Delete tracker REST route files under `apps/web/src/app/api/rest/tracker/` (if any)
- [ ] Update `ThreadCard.tsx`: replace `trackerIssueIdentifier`/`trackerIssueUrl` props with `linearIssueId`/`linearIssueUrl`
- [ ] Update `ThreadList.tsx`: pass `linearIssueId`/`linearIssueUrl` from thread data to ThreadCard
- [ ] Remove tracker connection management section from workspace settings page
- [ ] Ensure `TriageSection.tsx` still works (it already uses `linearIssueId`/`linearIssueUrl` — no change needed)

### Wiring

- [ ] Update thread list query (tRPC or server component) to select `linearIssueId`/`linearIssueUrl` instead of `trackerIssueIdentifier`/`trackerIssueUrl`
- [ ] Update `ThreadListItem` interface in `ThreadList.tsx` to remove tracker fields, add linear fields
- [ ] Grep for any remaining references to `trackerIssue`, `TrackerConnection`, `TrackerService`, `TrackerType` — remove all

### Cleanup

- [ ] Run `npm run type-check` across all packages
- [ ] Run `npm run build` for web + queue + codex
- [ ] Remove `@linear/sdk` from `packages/rest/package.json` only if `linear-client.ts` doesn't use it (it does — keep it)

---

## 4. Testing Checklist

### Happy Path

- [ ] Configure Linear API key + team in agent settings → saves correctly
- [ ] Inbound message → auto-triage creates Linear ticket with LLM-generated body, severity, labels
- [ ] ThreadCard shows Linear issue badge (e.g., "ENG-42") linking to Linear
- [ ] TriageSection shows "Update ENG-42" after ticket exists → updates, not duplicates
- [ ] Manual triage click → creates ticket when none exists
- [ ] Fix-PR → PR description includes Linear issue identifier
- [ ] Thread → IN_PROGRESS → no auto-ticket creation (old tracker path removed)

### Validation

- [ ] No Linear config → Gate 2 skips triage, analysis + draft still saved
- [ ] Invalid Linear API key → triage fails with clear error, pipeline continues

### Edge Cases

- [ ] Thread already has `linearIssueId` → triage updates existing issue
- [ ] Linear issue deleted externally → `getLinearIssue()` returns null → creates new
- [ ] Concurrent auto-pipeline + manual triage → `linearIssueId` @unique prevents duplicates

### Type Safety & Build

- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds for web + queue + codex
- [ ] No references to `trackerIssue*`, `TrackerConnection`, `TrackerService` remain in source
- [ ] No broken imports from deleted files
