# Engineering Spec: UI-First Customer Thread Inbox (Discord-Ready Contract)

## 1. Job to Be Done

Build the customer support inbox UI first, so operators can view customers, open threads, and track thread statuses now, while a teammate later plugs in Discord ingestion using a predefined backend contract.

- **Who** is the user/actor?
  - Support operators and workspace admins using the dashboard.
- **What** do they need to accomplish?
  - See incoming customer conversations grouped by customer/thread.
  - Open a thread, review messages, and move thread status (waiting review, waiting customer, escalated, closed).
  - Use a stable UI/API contract so Discord events can be connected later without UI rewrite.
- **Why** — what's the motivation or pain point?
  - UI development is blocked if it depends on live Discord integration.
  - Team needs parallel work: one person on UI experience, one person on ingestion pipeline.
- **Success criteria** — how do we know this is working?
  - `/inbox` and `/inbox/[threadId]` are fully usable with seeded/manual data.
  - Thread states are visible and filterable in the UI.
  - Backend exposes a clear ingestion procedure for external events (Discord-ready).
  - Teammate can integrate Discord by calling the contract without changing UI components.

## 2. Proposed Flow / Architecture

### Data model changes

Add new Prisma domain files under `packages/database/prisma/` (keep `schema.prisma` as generator/datasource entrypoint).

1. `customer.schema.prisma`
   - `Customer`
   - Fields: `id`, `workspaceId`, `source` (`DISCORD`, `MANUAL`, `API`), `externalCustomerId`, `displayName`, `avatarUrl`, `email`, `createdAt`, `updatedAt`
2. `thread.schema.prisma`
   - `SupportThread`
   - Fields: `id`, `workspaceId`, `customerId`, `source`, `externalThreadId`, `title`, `status`, `assignedToId`, `lastMessageAt`, `createdAt`, `updatedAt`
   - `ThreadStatus`: `NEW`, `WAITING_REVIEW`, `WAITING_CUSTOMER`, `ESCALATED`, `IN_PROGRESS`, `CLOSED`
3. `message.schema.prisma`
   - `ThreadMessage`
   - Fields: `id`, `threadId`, `direction` (`INBOUND`, `OUTBOUND`, `SYSTEM`), `body`, `externalMessageId`, `metadata`, `createdAt`
4. Add relations:
   - `Workspace` -> `customers`, `supportThreads`
   - `User` -> `assignedThreads`
5. Migration requirements:
   - `npm run db:migrate` and commit migration files
   - `npm run db:generate` to refresh `@shared/types`

### API layer

Follow existing `@shared/rest` patterns: routers in `packages/rest/src/routers/`, Zod schemas in `@shared/types`, `ctx.prisma` for data access.

1. `threadRouter` (UI-facing)
   - `listByWorkspace`
   - `getById`
   - `updateStatus`
   - `assign`
2. `messageRouter` (UI-facing)
   - `listByThread`
   - `createOutgoingDraft` (optional placeholder for later send action)
3. `intakeRouter` (integration contract for teammate)
   - `upsertExternalCustomer`
   - `upsertExternalThread`
   - `ingestExternalMessage`
   - `touchThreadStatusFromIngestion`
4. Zod schemas to add in `packages/types/src/schemas/index.ts`
   - `ListThreadsSchema`
   - `GetThreadByIdSchema`
   - `UpdateThreadStatusSchema`
   - `IngestExternalMessageSchema`
   - `UpsertExternalCustomerSchema`
5. Authorization
   - Match existing pattern: workspace membership checks in each procedure.
   - Reject cross-workspace thread/message access with `FORBIDDEN`.

### Frontend

Use Next.js App Router and shadcn UI components already in this repo.

1. Pages
   - `apps/web/src/app/(dashboard)/inbox/page.tsx` (server component)
   - `apps/web/src/app/(dashboard)/inbox/[threadId]/page.tsx` (server component)
2. Components
   - `apps/web/src/components/inbox/ThreadList.tsx`
   - `apps/web/src/components/inbox/ThreadCard.tsx`
   - `apps/web/src/components/inbox/ThreadFilters.tsx`
   - `apps/web/src/components/inbox/ThreadDetail.tsx`
   - `apps/web/src/components/inbox/MessageTimeline.tsx`
   - `apps/web/src/components/inbox/StatusActions.tsx`
3. Server/client boundary
   - Server components load initial thread/message data via `trpc` server caller.
   - Client components handle filters, status mutations, optimistic states.
4. Navigation
   - Add `Inbox` to `apps/web/src/components/app-sidebar.tsx`.
5. UI-first development mode
   - Manual form or seed endpoint to create customer/thread/messages before Discord is connected.

### Flow diagram

1. Operator opens `/inbox` and sees all threads for active workspace.
2. UI groups threads by status and customer identity.
3. Operator clicks a thread to open `/inbox/[threadId]`.
4. Detail page shows message timeline and current status.
5. Operator updates status (`WAITING_REVIEW`, `WAITING_CUSTOMER`, `ESCALATED`, etc.).
6. UI writes status via `thread.updateStatus` and refreshes list/detail.
7. Teammate later receives Discord message event.
8. Integration calls `intake.ingestExternalMessage` with external IDs and payload.
9. Backend upserts customer/thread, stores message, updates `lastMessageAt` and status.
10. UI automatically reflects new message/thread data using same existing components.

### Dependencies

1. No required Discord runtime dependency for UI-first milestone.
2. Optional future env keys in `@shared/env` (for teammate phase):
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_GUILD_ID`
   - `DISCORD_WEBHOOK_SECRET`
3. Existing stack reused:
   - `@shared/rest`, `@shared/types`, `@shared/database`, `@tanstack/react-query`, shadcn components.

## 3. Task Checklist

### Schema / Data

- [ ] Add `Customer`, `SupportThread`, and `ThreadMessage` models in new domain Prisma files.
- [ ] Add enums (`ThreadStatus`, `MessageDirection`, `CustomerSource`) and indexes for inbox queries.
- [ ] Add workspace/user relations for thread ownership and assignment.
- [ ] Run `npm run db:migrate` and commit migration output.
- [ ] Run `npm run db:generate` and export new model types via `@shared/types`.
- [ ] Add Zod schemas for thread list/detail/status and ingestion contracts in `packages/types/src/schemas/index.ts`.

### Backend / API

- [ ] Create `packages/rest/src/routers/thread.ts` with list/detail/status/assign procedures.
- [ ] Create `packages/rest/src/routers/message.ts` with list and draft procedures.
- [ ] Create `packages/rest/src/routers/intake.ts` with external upsert/ingest procedures.
- [ ] Register routers in `packages/rest/src/root.ts`.
- [ ] Add workspace membership checks for all thread/message/intake procedures.

### Frontend / UI

- [ ] Add `/inbox` route and render thread list + status filters.
- [ ] Add `/inbox/[threadId]` route and render message timeline + status actions.
- [ ] Add inbox components under `apps/web/src/components/inbox/` with typed props.
- [ ] Add sidebar nav item for Inbox.
- [ ] Add empty/loading/error states for list and detail views.

### Wiring

- [ ] Connect server pages to `trpc` server caller for initial data.
- [ ] Connect client mutations (`updateStatus`, assign) and query invalidation.
- [ ] Add temporary manual intake UI for creating test customer/thread/message records.
- [ ] Define ingestion payload contract docs so teammate can integrate Discord without UI changes.

### Cleanup

- [ ] Ensure all imports use `@shared/*` conventions and `import type` where applicable.
- [ ] Ensure no `any` in new code and use explicit component prop interfaces.
- [ ] Update CLAUDE/AGENTS docs only if architecture conventions materially change.

## 4. Testing Checklist

### Happy path

- [ ] Create manual customer/thread/message and verify it appears in `/inbox`.
- [ ] Open thread detail and verify message timeline renders in order.
- [ ] Change thread status and verify list + detail reflect update immediately.
- [ ] Simulate ingestion call (`intake.ingestExternalMessage`) and verify UI shows new message/thread.

### Validation

- [ ] Reject ingestion payload with missing `workspaceId`, `externalCustomerId`, or message body.
- [ ] Reject invalid thread status values with clear errors.
- [ ] Reject invalid cross-workspace thread IDs.

### Edge cases

- [ ] Empty inbox renders friendly empty state.
- [ ] Duplicate external message IDs do not create duplicate records.
- [ ] Concurrent status updates keep latest value and stable UI.
- [ ] Thread with missing customer avatar/email still renders correctly.

### Auth / Permissions

- [ ] Non-members cannot list workspace threads.
- [ ] Non-members cannot view thread detail by ID.
- [ ] Non-members cannot ingest messages into other workspaces.

### UI

- [ ] Desktop and mobile layouts work for list/detail screens.
- [ ] Loading states appear during fetch/mutation operations.
- [ ] Error banners/messages render for mutation failures.

### Type safety

- [ ] `npm run type-check` passes.

### Lint

- [ ] `npm run lint` passes.

### Build

- [ ] `npm run build` succeeds without prerender/runtime errors.

