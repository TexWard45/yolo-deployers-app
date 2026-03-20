# Workspace Feature — Engineering Spec

## Overview

Multi-tenant workspace system where users belong to one or more workspaces. All resource access (posts, etc.) is scoped to a workspace. Users can only see and interact with data tied to workspaces they belong to.

## Data Model

### ERD

```
User ──┐
       │ many-to-many via WorkspaceMember
       ▼
WorkspaceMember (userId, workspaceId, role)
       ▲
       │
Workspace ──── Post (workspaceId)
```

### Tables

#### Workspace

| Column    | Type     | Notes              |
|-----------|----------|--------------------|
| id        | String   | cuid, PK           |
| name      | String   | Display name       |
| slug      | String   | Unique, URL-safe   |
| createdAt | DateTime | Auto               |
| updatedAt | DateTime | Auto               |

#### WorkspaceMember (join table)

| Column      | Type          | Notes                        |
|-------------|---------------|------------------------------|
| id          | String        | cuid, PK                     |
| userId      | String        | FK → User                    |
| workspaceId | String        | FK → Workspace               |
| role        | WorkspaceRole | OWNER / ADMIN / MEMBER       |
| createdAt   | DateTime      | Auto                         |

- Unique constraint on `(userId, workspaceId)` — a user can only be a member once.
- `onDelete: Cascade` on both FKs — removing user or workspace cleans up memberships.

#### WorkspaceRole (enum)

| Value  | Description                                   |
|--------|-----------------------------------------------|
| OWNER  | Full control, can delete workspace             |
| ADMIN  | Can manage members, edit all content           |
| MEMBER | Can view and create content within workspace   |

#### Post (updated)

Added `workspaceId` (required FK → Workspace). All posts belong to exactly one workspace.

## Access Control

### Rule: Workspace-scoped visibility

Every query that returns user-facing data MUST filter by `workspaceId`. Users can only access resources in workspaces where they have a `WorkspaceMember` record.

### Enforcement points

1. **tRPC routers** — every procedure that reads/writes workspace-scoped data checks membership before proceeding. Throws `FORBIDDEN` if the user is not a member.
2. **Session** — on login, the user's workspace memberships are loaded and stored in the session cookie. The active workspace is tracked client-side.
3. **REST endpoints** — route handlers pass `workspaceId` and `userId` from the session into tRPC calls.

### Permission matrix

| Action              | OWNER | ADMIN | MEMBER |
|---------------------|-------|-------|--------|
| View workspace      | Yes   | Yes   | Yes    |
| Create post         | Yes   | Yes   | Yes    |
| Edit own post       | Yes   | Yes   | Yes    |
| Edit any post       | Yes   | Yes   | No     |
| Add member          | Yes   | Yes   | No     |
| Remove member       | Yes   | Yes   | No     |
| Delete workspace    | Yes   | No    | No     |
| Change member role  | Yes   | No    | No     |

## API Procedures

### `workspace.listByUser`

- **Input:** `{ userId: string }`
- **Returns:** Array of workspaces the user belongs to, with member count and post count.

### `workspace.getBySlug`

- **Input:** `{ slug: string, userId: string }`
- **Returns:** Full workspace with members. Throws `FORBIDDEN` if user is not a member.

### `workspace.create`

- **Input:** `{ name: string, slug: string, userId: string }`
- **Behavior:** Creates workspace, adds creator as `OWNER`. Throws `CONFLICT` if slug taken.

### `workspace.addMember`

- **Input:** `{ workspaceId: string, userId: string, role?: WorkspaceRole }`
- **Behavior:** Adds user to workspace. Throws `CONFLICT` if already a member.

### `workspace.removeMember`

- **Input:** `{ workspaceId: string, userId: string }`
- **Behavior:** Removes user from workspace.

### `post.list` (updated)

- **Input:** `{ workspaceId: string, userId: string }`
- **Behavior:** Returns posts scoped to workspace. Verifies membership first.

### `post.create` (updated)

- **Input:** `{ title, content, published, authorId, workspaceId }`
- **Behavior:** Creates post in workspace. Verifies author is a member.

## REST Endpoints

| Method | URL                 | Description                       |
|--------|---------------------|-----------------------------------|
| GET    | /api/rest/workspace | List user's workspaces (?userId=) |
| POST   | /api/rest/workspace | Create workspace (JSON body)      |
| GET    | /api/rest/user      | List users                        |
| POST   | /api/rest/user      | Create user                       |
| GET    | /api/rest/post      | List posts                        |
| POST   | /api/rest/post      | Create post                       |

Auth (login/signup/logout) is NOT exposed as REST — handled via server actions + tRPC internally.

## Session Shape

```ts
{
  id: string;
  username: string;
  name: string | null;
  isSystemAdmin: boolean;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
  }>;
}
```

Stored as httpOnly cookie. On login, all workspace memberships are loaded.

## User Flow

1. User signs up → no workspaces yet
2. User creates a workspace → becomes OWNER
3. OWNER/ADMIN invites other users by username → they become MEMBERs
4. User selects active workspace in UI (workspace switcher)
5. All data (posts, etc.) is filtered to the active workspace
6. User can switch between workspaces they belong to

## File Locations

```
packages/database/prisma/schema.prisma     → Workspace, WorkspaceMember models
packages/types/src/schemas/index.ts        → CreateWorkspaceSchema, AddWorkspaceMemberSchema
packages/types/src/index.ts                → re-exports Workspace, WorkspaceMember, WorkspaceRole
packages/rest/src/routers/workspace.ts     → workspace tRPC router
packages/rest/src/routers/post.ts          → updated: workspace-scoped queries
packages/rest/src/routers/auth.ts          → updated: loads workspaces on login
apps/web/src/actions/auth.ts               → updated: session includes workspaces
apps/web/src/app/api/rest/workspace/       → REST endpoint
```

## Future Considerations

- Workspace settings/billing per workspace
- Workspace-level API keys for external integrations
- Audit log per workspace
- Invite links (shareable URL to join a workspace)
- Role-based UI rendering (hide admin actions from MEMBERs)
