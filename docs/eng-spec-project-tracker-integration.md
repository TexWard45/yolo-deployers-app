# Engineering Spec: Project Tracker Integration (Linear + Jira-Ready)

## 1. Job to Be Done

- **Who**: Workspace operators / support agents.
- **What**: Connect one or more project tracker boards (Linear now, Jira later) to a workspace via API key. Automatically create issues when a `SupportThread` transitions to `IN_PROGRESS`, and link the resulting issue back to the thread.
- **Why**: Support teams use external trackers to manage work. Manual ticket creation is error-prone and slow. A generic, multi-connection model eliminates context-switching, supports teams that use multiple boards, and makes adding new providers (Jira, GitHub Issues, etc.) a backend-only change.
- **Success criteria**:
  1. An operator can connect a Linear team by pasting an API key and selecting a team — no OAuth app setup required.
  2. A workspace can have **multiple** tracker connections (e.g. "Bugs → Linear ENG", "Features → Linear PROD").
  3. One connection is marked **default** — used for auto-creating issues when threads move to `IN_PROGRESS`.
  4. The issue identifier (e.g. `ENG-42`) is stored on the thread and visible in the inbox UI.
  5. Disconnecting a tracker stops auto-creation without deleting existing issue links.
  6. Adding Jira support later requires only: a new `TrackerType` enum value, a Jira-specific service module, and UI for Jira-specific fields — no schema migration needed.

---

## 2. Proposed Flow / Architecture

### 2.1 Data Model Changes

**Replace `LinearConnection` with generic `TrackerConnection`** (in `tracker.schema.prisma`):

```prisma
enum TrackerType {
  LINEAR
  JIRA        // future — no code needed until implementation
}

model TrackerConnection {
  id             String      @id @default(cuid())
  workspaceId    String
  workspace      Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  type           TrackerType               // LINEAR, JIRA, etc.
  label          String                    // user-given name, e.g. "Bugs board"
  apiToken       String                    // Linear API key or Jira API token
  projectKey     String                    // Linear team ID or Jira project key
  projectName    String                    // display name, e.g. "Engineering"
  siteUrl        String?                   // null for Linear; e.g. "https://myteam.atlassian.net" for Jira
  configJson     Json?                     // provider-specific extras (Jira issue type, priority, etc.)

  enabled        Boolean     @default(true)
  isDefault      Boolean     @default(false)  // which connection auto-creates on IN_PROGRESS
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  @@index([workspaceId, type])
  @@index([workspaceId, isDefault])
}
```

> **Why generic?** This mirrors the existing `ChannelConnection` pattern (`type: DISCORD | IN_APP`). Adding Jira is: add `JIRA` to the enum, add a `jira.service.ts`, done. No schema migration needed.

**Field additions on `SupportThread`** (in `thread.schema.prisma`):

```prisma
  trackerIssueId         String?           // external issue UUID/key
  trackerIssueIdentifier String?           // human-readable, e.g. "ENG-42" or "SUP-123"
  trackerIssueUrl        String?           // full URL to the issue
  trackerConnectionId    String?           // which TrackerConnection created this issue
```

> **Note:** Fields are provider-agnostic. `trackerConnectionId` lets us know which connection owns the issue (useful when multiple connections exist).

**Relation on `Workspace`** (in `workspace.schema.prisma`):

```prisma
  trackerConnections  TrackerConnection[]   // replaces linearConnection
```

### 2.2 API Layer

#### New tRPC Router: `packages/rest/src/routers/tracker.ts`

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `tracker.list` | query | `protectedProcedure` | List all `TrackerConnection` rows for a workspace. |
| `tracker.create` | mutation | `protectedProcedure` (OWNER/ADMIN) | Create a new connection. Validates API key by fetching projects from the provider. |
| `tracker.update` | mutation | `protectedProcedure` (OWNER/ADMIN) | Update label, projectKey, enabled, isDefault. |
| `tracker.delete` | mutation | `protectedProcedure` (OWNER/ADMIN) | Delete a connection. |
| `tracker.setDefault` | mutation | `protectedProcedure` (OWNER/ADMIN) | Mark one connection as default (unsets previous default). |
| `tracker.listProjects` | query | `protectedProcedure` | Given a connection ID (or type + apiToken for pre-creation validation), fetch available projects/teams from the provider API. |

#### No OAuth Routes Needed

API key-based auth means no `/api/linear/auth` or `/api/linear/callback` routes. The operator pastes their key directly in the settings form.

**How to get an API key:**
- **Linear**: Settings → API → Personal API keys → Create key
- **Jira (future)**: Profile → Security → API tokens → Create token (+ site URL)

#### Provider Service Layer: `packages/rest/src/lib/tracker/`

```
packages/rest/src/lib/tracker/
  index.ts              → getTrackerService(type) dispatcher
  types.ts              → TrackerService interface
  linear.service.ts     → Linear GraphQL implementation
  jira.service.ts       → (future) Jira REST v3 implementation
```

**`TrackerService` interface:**

```ts
interface TrackerService {
  listProjects(apiToken: string, siteUrl?: string): Promise<TrackerProject[]>;
  createIssue(params: CreateTrackerIssueParams): Promise<TrackerIssueResult>;
  validateToken(apiToken: string, siteUrl?: string): Promise<boolean>;
}

interface TrackerProject {
  id: string;
  name: string;
  key: string;
}

interface TrackerIssueResult {
  id: string;
  identifier: string;   // e.g. "ENG-42"
  url: string;
}

interface CreateTrackerIssueParams {
  apiToken: string;
  siteUrl?: string;
  projectKey: string;
  title: string;
  description?: string;
  configJson?: Record<string, unknown>;  // provider-specific (issue type, etc.)
}
```

**`getTrackerService(type)`** returns the correct implementation:

```ts
function getTrackerService(type: TrackerType): TrackerService {
  switch (type) {
    case "LINEAR": return linearService;
    case "JIRA":   return jiraService;   // future
  }
}
```

#### Issue Creation Trigger

**Trigger point** remains `thread.updateStatus` in `packages/rest/src/routers/thread.ts`:

1. After status changes to `IN_PROGRESS`, look up the workspace's **default** `TrackerConnection` (where `isDefault: true` and `enabled: true`).
2. If found and thread has no `trackerIssueId`, call `getTrackerService(connection.type).createIssue(...)`.
3. Save `trackerIssueId`, `trackerIssueIdentifier`, `trackerIssueUrl`, and `trackerConnectionId` on the thread.
4. Fire-and-forget — never block the status update.

> **Note:** `IN_PROGRESS` is only set via manual operator action. Ingestion and ejections set `WAITING_REVIEW` / `NEW`, so they do not trigger issue creation.

#### New Zod Schemas (in `packages/types/src/schemas/index.ts`)

```ts
export const TrackerTypeSchema = z.enum(["LINEAR", "JIRA"]);

export const CreateTrackerConnectionSchema = z.object({
  workspaceId: z.string(),
  type: TrackerTypeSchema,
  label: z.string().min(1).max(100),
  apiToken: z.string().min(1),
  projectKey: z.string().min(1),
  projectName: z.string().min(1),
  siteUrl: z.string().url().optional(),          // required for Jira, optional for Linear
  configJson: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

export const UpdateTrackerConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  label: z.string().min(1).max(100).optional(),
  projectKey: z.string().min(1).optional(),
  projectName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
});

export const DeleteTrackerConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
});

export const ListTrackerProjectsSchema = z.object({
  workspaceId: z.string(),
  connectionId: z.string().optional(),    // use existing connection's token
  type: TrackerTypeSchema.optional(),     // or provide type + token for pre-creation
  apiToken: z.string().optional(),
  siteUrl: z.string().url().optional(),
});
```

### 2.3 Frontend

#### Settings → Integrations Section

- **List of connections**: each card shows type icon (Linear/Jira), label, project name, enabled badge, default badge, edit/delete buttons.
- **"Add Connection" button** → opens form:
  - Select type (Linear / Jira)
  - Paste API key
  - (Jira only) Enter site URL
  - Click "Fetch Projects" → populates project/team picker
  - Enter a label
  - Toggle "Set as default"
  - Submit
- **Validation**: on form submit, call `tracker.listProjects` to verify the API key works before creating the connection.

#### Thread Detail / Inbox UI Changes

- In `ThreadDetailSheet.tsx` and `ThreadDetail.tsx`: if `trackerIssueIdentifier` is set, render a linked badge with provider icon (e.g. Linear diamond or Jira icon) + issue key.
- In `ThreadList.tsx` Kanban cards: small badge with issue identifier if present.

### 2.4 User Flow

1. Operator navigates to **Settings → Integrations**.
2. Clicks **"Add Connection"**, selects **Linear**.
3. Pastes their Linear API key (from Linear → Settings → API → Personal API keys).
4. Clicks **"Fetch Teams"** → dropdown populated with available teams.
5. Selects a team, enters a label (e.g. "Support Bugs"), toggles "Set as default".
6. Clicks **Save** → `TrackerConnection` created.
7. (Optional) Repeats steps 2-6 for another team or a Jira board.
8. A customer sends a message → thread enters `WAITING_REVIEW` via ingestion.
9. Operator reviews the thread and moves it to `IN_PROGRESS`.
10. System finds the default `TrackerConnection`, calls the appropriate provider service to create an issue.
11. Operator sees the issue link on the thread in the inbox.

### 2.5 Dependencies

- **New env vars**: None — API keys are stored per-connection in the database. No global `LINEAR_CLIENT_ID`/`SECRET` needed.
- **NPM packages**: None (use `fetch` for provider APIs).
- **Removed**: `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_REDIRECT_URI` env vars and OAuth routes are no longer needed.

### 2.6 Adding Jira (Future)

When ready to add Jira support:

1. **No schema migration** — `JIRA` is already in the `TrackerType` enum. Just add the value.
2. **Create `packages/rest/src/lib/tracker/jira.service.ts`** implementing `TrackerService`:
   - `listProjects` → `GET https://{siteUrl}/rest/api/3/project`
   - `createIssue` → `POST https://{siteUrl}/rest/api/3/issue`
   - `validateToken` → `GET https://{siteUrl}/rest/api/3/myself`
   - Auth: `Authorization: Basic base64(email:apiToken)`
   - `configJson` carries Jira-specific fields: `issueTypeId`, `priorityId`, `labels`, etc.
3. **Register in `getTrackerService`** switch statement.
4. **UI**: The "Add Connection" form already supports type selection. Add Jira-specific fields (site URL, issue type picker) conditionally rendered when `type === "JIRA"`.

### 2.7 Current Schema Context

- `SupportThread` — single thread model with `ThreadMessage[]`, `ReplyDraft[]`, `Customer` relation.
- `ChannelConnection` — workspace-scoped, type `DISCORD | IN_APP`. The new `TrackerConnection` follows this same pattern.
- No `Conversation`, `CustomerProfile`, or `CustomerChannelIdentity` models exist.

---

## 3. Task Checklist

### Schema / Data

- [x] Create `tracker.schema.prisma` with `TrackerType` enum and `TrackerConnection` model
- [x] Add `trackerIssueId`, `trackerIssueIdentifier`, `trackerIssueUrl`, `trackerConnectionId` to `SupportThread`
- [x] Add `trackerConnections` relation on `Workspace`
- [x] Run `npm run db:generate` and `npm run db:push`
- [x] Add Zod schemas (`TrackerTypeSchema`, `CreateTrackerConnectionSchema`, `UpdateTrackerConnectionSchema`, `DeleteTrackerConnectionSchema`, `ListTrackerProjectsSchema`) in `packages/types/src/schemas/index.ts`

### Backend / API

- [x] Create `packages/rest/src/lib/tracker/types.ts` with `TrackerService` interface
- [x] Create `packages/rest/src/lib/tracker/linear.service.ts` implementing `TrackerService` (uses `@linear/sdk`)
- [x] Create `packages/rest/src/lib/tracker/index.ts` with `getTrackerService()` dispatcher and `maybeCreateTrackerIssueForThread()` helper
- [x] Create `packages/rest/src/routers/tracker.ts` with `list`, `create`, `update`, `delete`, `setDefault`, `listProjects`
- [x] Register `trackerRouter` in `packages/rest/src/root.ts`
- [x] Hook `thread.updateStatus` to call `maybeCreateTrackerIssueForThread()` on `IN_PROGRESS`
- [x] Create `/api/rest/tracker/projects` REST route for project fetching
- [x] Unit tests: `tracker.unit.test.ts` and `linear.service.unit.test.ts` (8 tests, all passing)

### Frontend / UI

- [x] Create `TrackerConnectionCard` — shows type, label, project, enabled/default badges, set-default/delete buttons
- [x] Create `AddTrackerForm` — API key input, "Fetch Teams" button, project picker, label, default toggle
- [x] Update Settings page to list all tracker connections + add form
- [x] Add tracker issue badge to `ThreadDetailSheet.tsx` (right sidebar)
- [x] Add tracker issue badge to `ThreadCard.tsx` (Kanban cards)
- [x] Update `ThreadList.tsx` to pass tracker fields through

### Wiring

- [x] Export new Zod schemas from `@shared/types`
- [x] Add `./tracker` export to `@shared/rest` package.json
- [x] Server actions: `createTrackerConnection`, `deleteTrackerConnection`, `setDefaultTrackerConnection` (all revalidate `/settings`)

---

## 4. Testing Checklist

### Happy Path

- [x] Add Linear connection via API key → `TrackerConnection` created, teams fetched and selectable
- [ ] Add a second Linear connection to same workspace → both appear in list
- [ ] Set one connection as default → previous default unset
- [x] Thread transitions to `IN_PROGRESS` → issue created in default tracker (verified: YOL-5 created)
- [ ] Issue link is visible and clickable in thread detail and Kanban card
- [ ] Delete a tracker connection → removed from list, no more auto-creation if it was default

### Validation

- [ ] `tracker.create` rejects invalid API keys (calls `validateToken`, returns clear error)
- [ ] `tracker.create` / `tracker.update` rejects non-OWNER/ADMIN users
- [ ] `tracker.create` with Jira type requires `siteUrl`
- [ ] `tracker.delete` rejects if connection belongs to different workspace

### Edge Cases

- [ ] Thread already has `trackerIssueId` → no duplicate issue on re-transition to `IN_PROGRESS`
- [ ] Default connection is `enabled: false` → no issue created
- [ ] No default connection set → no issue created, no error
- [ ] Provider API returns error → thread status still updates, error logged, no crash
- [ ] Multiple rapid status changes to `IN_PROGRESS` → only one issue created (idempotency)
- [ ] Delete connection that created existing thread issues → thread still shows issue link (orphaned gracefully)

### Auth / Permissions

- [ ] Only OWNER/ADMIN can create/update/delete connections
- [ ] All workspace members can see connection list (read-only)
- [ ] API tokens are never returned in list queries (select omits `apiToken`)

### UI

- [ ] Settings shows empty state with "Add Connection" button when no connections exist
- [ ] Settings shows list of connections with correct type icons, labels, badges
- [ ] Add connection form validates before submit (API key not empty, project selected)
- [ ] Delete confirmation dialog works
- [ ] Issue badge renders correctly with provider-appropriate styling

### Type Safety & Build

- [x] `npm run type-check` passes (all 7 packages, 0 errors)
- [ ] `npm run build` succeeds
- [x] `npm run db:generate` produces correct types including new fields
- [x] Unit tests pass (8/8 — `tracker.unit.test.ts` + `linear.service.unit.test.ts`)
