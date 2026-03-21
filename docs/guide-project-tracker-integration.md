# Project Tracker Integration — Developer Guide

## Overview

The project tracker integration auto-creates issues in external project management tools (Linear, Jira in future) when support threads move to `IN_PROGRESS`. It uses a generic `TrackerConnection` model that supports multiple providers via a pluggable service architecture.

## Architecture

```
packages/rest/src/lib/tracker/
  types.ts              → TrackerService interface (validateToken, listProjects, createIssue)
  linear.service.ts     → Linear implementation (uses @linear/sdk)
  index.ts              → getTrackerService() dispatcher + maybeCreateTrackerIssueForThread()

packages/rest/src/routers/tracker.ts    → tRPC router (list, create, update, delete, setDefault, listProjects)
packages/database/prisma/tracker.schema.prisma → TrackerConnection model + TrackerType enum

apps/web/src/components/settings/
  TrackerConnectionCard.tsx   → Connection card with set-default / delete actions
  AddTrackerForm.tsx          → Form to add new connections (API key + team picker)

apps/web/src/actions/tracker.ts         → Server actions for create/delete/setDefault
apps/web/src/app/api/rest/tracker/projects/route.ts → REST route for fetching projects
```

## Data Model

### TrackerConnection

```prisma
model TrackerConnection {
  id             String      @id @default(cuid())
  workspaceId    String
  type           TrackerType      // LINEAR | JIRA
  label          String           // user-given name
  apiToken       String           // provider API key (stored in DB, not env vars)
  projectKey     String           // Linear team ID or Jira project key
  projectName    String           // display name
  siteUrl        String?          // null for Linear; required for Jira
  configJson     Json?            // provider-specific extras
  enabled        Boolean @default(true)
  isDefault      Boolean @default(false)   // auto-create issues from this connection
}
```

- Multiple connections per workspace (no unique constraint on workspaceId)
- One connection marked `isDefault` — used for auto-creating issues on `IN_PROGRESS`
- `apiToken` is never returned in list queries (omitted from select)

### SupportThread Fields

```prisma
trackerIssueId         String?    // external issue UUID
trackerIssueIdentifier String?    // human-readable, e.g. "YOL-5"
trackerIssueUrl        String?    // full URL
trackerConnectionId    String?    // which connection created this issue
```

## How It Works

### Auto-creation Flow

1. Operator moves a thread to `IN_PROGRESS` (drag-and-drop or status button)
2. `thread.updateStatus` mutation fires
3. After updating status, calls `maybeCreateTrackerIssueForThread()` (fire-and-forget)
4. Looks up workspace's default `TrackerConnection` (`isDefault: true`, `enabled: true`)
5. If found and thread has no `trackerIssueId`, dispatches to the provider service
6. Provider creates the issue, returns `{ id, identifier, url }`
7. Saves result on the thread

The status update is never blocked — Linear API errors are logged but don't affect the user.

### TrackerService Interface

```typescript
interface TrackerService {
  validateToken(apiToken: string, siteUrl?: string | null): Promise<boolean>;
  listProjects(apiToken: string, siteUrl?: string | null): Promise<TrackerProject[]>;
  createIssue(params: CreateTrackerIssueParams): Promise<TrackerIssueResult>;
}
```

### getTrackerService Dispatcher

```typescript
function getTrackerService(type: string): TrackerService {
  switch (type) {
    case "LINEAR": return linearService;
    // case "JIRA": return jiraService;  // future
    default: throw new Error(`Unsupported tracker type: ${type}`);
  }
}
```

## tRPC Procedures

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `tracker.list` | query | protectedProcedure | List all connections for a workspace |
| `tracker.create` | mutation | OWNER/ADMIN | Create connection (validates API key first) |
| `tracker.update` | mutation | OWNER/ADMIN | Update label, project, enabled, isDefault |
| `tracker.delete` | mutation | OWNER/ADMIN | Delete a connection |
| `tracker.setDefault` | mutation | OWNER/ADMIN | Set one connection as default (unsets others) |
| `tracker.listProjects` | query | protectedProcedure | Fetch projects from provider API |

## Adding a New Provider (e.g. Jira)

1. Create `packages/rest/src/lib/tracker/jira.service.ts`:

```typescript
import type { TrackerService } from "./types";

export const jiraService: TrackerService = {
  async validateToken(apiToken, siteUrl) {
    // GET https://{siteUrl}/rest/api/3/myself
    // Auth: Basic base64(email:apiToken)
  },
  async listProjects(apiToken, siteUrl) {
    // GET https://{siteUrl}/rest/api/3/project
  },
  async createIssue(params) {
    // POST https://{siteUrl}/rest/api/3/issue
    // Use params.configJson for issueTypeId, priorityId, etc.
  },
};
```

2. Register in `packages/rest/src/lib/tracker/index.ts`:

```typescript
case "JIRA": return jiraService;
```

3. In `AddTrackerForm.tsx`, conditionally show `siteUrl` input when `type === "JIRA"`.

No schema migration, no new env vars, no new routes needed.

## Testing

### Unit Tests

```bash
# Run tracker dispatcher tests
cd packages/rest && node --import tsx --test src/lib/tracker/tracker.unit.test.ts

# Run linear service tests
cd packages/rest && node --import tsx --test src/lib/tracker/linear.service.unit.test.ts

# Run all rest package tests
cd packages/rest && npm test
```

### Test Files

| File | Tests | What it covers |
|---|---|---|
| `tracker.unit.test.ts` | 4 | `getTrackerService` dispatcher (valid type, unsupported type, case sensitivity) |
| `linear.service.unit.test.ts` | 4 | `linearService` interface compliance, invalid token handling |

### Manual Testing

1. Get a Linear API key: Linear → Settings → API → Personal API keys → Create
2. Start dev server: `doppler run --config dev --project 4chuhe_web -- npm run dev --workspace @app/web`
3. Login → Settings → Integrations → Add Connection
4. Paste API key → Fetch Teams → Select team → Save
5. Go to Inbox → Drag a thread to IN_PROGRESS → Check Linear for new issue

## Environment

No env vars needed for the tracker integration. API keys are stored per-connection in the database. The `@linear/sdk` package is a dependency of `@shared/rest`.
