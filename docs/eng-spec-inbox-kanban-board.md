# Engineering Spec: Inbox Kanban Board

## 1. Job to Be Done

- **Who**: Support agents and workspace members using the dashboard.
- **What**: Visually triage, track, and update customer support threads across lifecycle stages using a drag-and-drop Kanban board.
- **Why**: A flat thread list makes it hard to see what needs attention. A Kanban board grouped by status gives instant visibility into queue health — how many threads are new, waiting on review, waiting on the customer, escalated, in progress, or closed.
- **Success criteria**:
  - Threads appear in columns matching their `ThreadStatus`.
  - Dragging a card between columns persists the new status to the database.
  - Clicking a card opens a detail sheet (sidebar) without leaving the board.
  - Discord-ingested threads appear automatically in the correct column.
  - The board works with zero threads (empty states per column).

---

## 2. Proposed Flow / Architecture

### Data Model

All models live in `packages/database/prisma/` as multi-file Prisma schemas.

**`thread.schema.prisma`** — Two core models:

```
enum ThreadStatus {
  NEW
  WAITING_REVIEW
  WAITING_CUSTOMER
  ESCALATED
  IN_PROGRESS
  CLOSED
}

enum MessageDirection {
  INBOUND
  OUTBOUND
  SYSTEM
}

model SupportThread {
  id               String         @id @default(cuid())
  workspaceId      String
  workspace        Workspace      @relation(...)
  customerId       String
  customer         Customer       @relation(...)
  source           CustomerSource          // DISCORD | MANUAL | API
  externalThreadId String                  // dedup key from external source
  title            String?
  status           ThreadStatus   @default(NEW)
  assignedToId     String?
  assignedTo       User?          @relation("AssignedSupportThreads", ...)
  lastMessageAt    DateTime?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  messages         ThreadMessage[]

  @@unique([workspaceId, source, externalThreadId])
  @@index([workspaceId, status, updatedAt])
  @@index([customerId, createdAt])
}

model ThreadMessage {
  id                String           @id @default(cuid())
  threadId          String
  thread            SupportThread    @relation(...)
  direction         MessageDirection
  body              String
  externalMessageId String?
  metadata          Json?
  createdAt         DateTime         @default(now())

  @@unique([threadId, externalMessageId])
  @@index([threadId, createdAt])
}
```

**`customer.schema.prisma`** — Customer model (one per external identity per workspace):

```
enum CustomerSource { DISCORD, MANUAL, API }

model Customer {
  id                 String         @id @default(cuid())
  workspaceId        String
  source             CustomerSource
  externalCustomerId String          // dedup key
  displayName        String
  avatarUrl          String?
  email              String?
  threads            SupportThread[]

  @@unique([workspaceId, source, externalCustomerId])
}
```

### API Layer

All tRPC routers in `packages/rest/src/routers/`. All Zod schemas in `packages/types/src/schemas/index.ts`.

#### Thread Router (`thread.ts`)

| Procedure | Type | Auth | Description |
|-----------|------|------|-------------|
| `thread.listByWorkspace` | query | `protectedProcedure` | List threads for a workspace, optionally filter by status. Includes `customer`, `assignedTo`, `_count.messages`. |
| `thread.getById` | query | `protectedProcedure` | Get single thread with customer, assignee, and all messages. |
| `thread.updateStatus` | mutation | `protectedProcedure` | Change thread status. **This is what drag-and-drop calls.** |
| `thread.assign` | mutation | `protectedProcedure` | Assign/unassign a thread to a workspace member. |

All procedures verify the caller is a workspace member via `assertWorkspaceMember`.

**Zod input schemas:**

| Schema | Fields |
|--------|--------|
| `ListThreadsSchema` | `workspaceId`, `status?` |
| `GetThreadByIdSchema` | `threadId` |
| `UpdateThreadStatusSchema` | `threadId`, `status` (enum) |
| `AssignThreadSchema` | `threadId`, `assignedToId` (nullable) |

#### Intake Router (`intake.ts`)

Handles message ingestion from external sources (Discord bot, manual UI, API).

| Procedure | Type | Description |
|-----------|------|-------------|
| `intake.ingestExternalMessage` | mutation | Atomic upsert: creates/updates customer + thread + message in a transaction. Sets status to `WAITING_REVIEW` on new threads. |
| `intake.upsertExternalCustomer` | mutation | Create or update a customer by external ID. |
| `intake.upsertExternalThread` | mutation | Create or update a thread by external thread ID. |
| `intake.touchThreadStatusFromIngestion` | mutation | Update thread status from an external system. |

#### Server Actions (`apps/web/src/actions/inbox.ts`)

| Action | Description |
|--------|-------------|
| `getThreadDetail(threadId)` | Fetches full thread (with messages) for the detail sheet. |
| `updateThreadStatusAction({ threadId, status })` | Calls `thread.updateStatus`, then `revalidatePath("/inbox")`. |
| `createManualInboundMessage(...)` | Calls `intake.ingestExternalMessage` for manual UI intake. |

### Frontend

#### Page: `/inbox` (`apps/web/src/app/(dashboard)/inbox/page.tsx`)

- **Server component** with `force-dynamic`.
- Authenticates via `getSession()`, redirects to `/login` if unauthenticated.
- Fetches threads via `trpc.thread.listByWorkspace({ workspaceId })`.
- Renders `<ThreadList threads={threads} />`.

#### Component Tree

```
InboxPage (server)
└── ThreadList (client — "use client")
    ├── Column × 6 (one per ThreadStatus)
    │   └── ThreadCard × N (client, draggable)
    └── ThreadDetailSheet (client — Sheet sidebar)
        ├── ThreadStatusBadge
        ├── StatusActions (status change buttons)
        └── Message timeline
```

#### Key Components

| Component | File | Description |
|-----------|------|-------------|
| `ThreadList` | `components/inbox/ThreadList.tsx` | Kanban board. Groups threads by status into 6 columns. Manages drag-and-drop state, selected thread ID, and optimistic updates via `useState`. |
| `ThreadCard` | `components/inbox/ThreadCard.tsx` | Individual card. Shows customer initial, name, title, assignee avatar, relative time. Supports `onClick` (open sheet) and HTML5 drag. |
| `ThreadDetailSheet` | `components/inbox/ThreadDetailSheet.tsx` | Right-side Sheet (shadcn). Fetches full thread detail via `getThreadDetail` server action. Shows status badge, status action buttons, and message timeline. |
| `StatusActions` | `components/inbox/StatusActions.tsx` | Row of buttons for each `ThreadStatus`. Calls `updateThreadStatusAction` on click. |
| `ThreadStatusBadge` | `components/inbox/ThreadStatusBadge.tsx` | Colored badge for status (destructive for ESCALATED, secondary for CLOSED, outline for rest). |
| `thread-status.ts` | `components/inbox/thread-status.ts` | Constants: `THREAD_STATUSES` array, `ThreadStatusValue` type, `THREAD_STATUS_LABEL` map. |

### User Flow: Drag-and-Drop Status Update

1. User views the Kanban board at `/inbox` — threads grouped in 6 columns.
2. User grabs a card (HTML5 `draggable`).
3. User drags it over a different status column — column highlights (`bg-accent/30`).
4. User drops the card.
5. `handleDrop` fires:
   - Reads `threadId` from `dataTransfer`.
   - If same column, no-op.
   - Calls `setLocalThreads(...)` — **optimistic**: card moves instantly.
   - Fires `updateThreadStatusAction({ threadId, status })` in background.
6. Server action calls `trpc.thread.updateStatus`, then `revalidatePath("/inbox")`.
7. Next.js re-fetches page data; `useEffect` syncs fresh `threads` prop into `localThreads`.

### User Flow: Thread Detail Sheet

1. User clicks a card in the board.
2. `ThreadList` sets `selectedId` state.
3. `ThreadDetailSheet` opens (Sheet component, `open={threadId !== null}`).
4. `useEffect` calls `getThreadDetail(threadId)` server action.
5. Sheet displays: title, status badge, customer info, status action buttons, message timeline.
6. User can change status via buttons inside the sheet (calls `updateThreadStatusAction`).
7. Closing the sheet sets `selectedId` to `null`.

### User Flow: Discord Intake (External Integration)

1. Discord bot captures a message in a support channel.
2. Bot calls `intake.ingestExternalMessage` with workspace ID, external customer/thread IDs, message body.
3. Procedure atomically upserts customer, upserts thread (status `WAITING_REVIEW`), creates message, updates `lastMessageAt`.
4. Next page load of `/inbox` shows the new thread in the **Waiting Review** column.

### Dependencies

- No additional npm packages required — uses HTML5 Drag and Drop API (native browser).
- shadcn `Sheet` component for the detail sidebar.
- All existing: `@shared/rest`, `@shared/types`, `@shared/database`, `@shared/env`.

---

## 3. Task Checklist

### Schema / Data

- [x] Add `ThreadStatus` and `MessageDirection` enums to `thread.schema.prisma`
- [x] Add `SupportThread` model with status, customer, assignee relations
- [x] Add `ThreadMessage` model with direction and external ID dedup
- [x] Add `CustomerSource` enum and `Customer` model to `customer.schema.prisma`
- [x] Run `db:generate` to regenerate Prisma types into `@shared/types`
- [x] Run `db:push` to sync schema to database
- [x] Add Zod schemas: `ThreadStatusSchema`, `ListThreadsSchema`, `GetThreadByIdSchema`, `UpdateThreadStatusSchema`, `AssignThreadSchema`
- [x] Add Zod schemas: `IngestExternalMessageSchema`, `UpsertExternalCustomerSchema`, `UpsertExternalThreadSchema`
- [x] Create seed script (`packages/database/prisma/seed.ts`) with 15 threads across all statuses

### Backend / API

- [x] Create `threadRouter` with `listByWorkspace`, `getById`, `updateStatus`, `assign` procedures
- [x] Create `intakeRouter` with `ingestExternalMessage`, `upsertExternalCustomer`, `upsertExternalThread`, `touchThreadStatusFromIngestion`
- [x] Register both routers in `appRouter` (`packages/rest/src/root.ts`)
- [x] Create `getThreadDetail` server action in `apps/web/src/actions/inbox.ts`
- [x] Create `updateThreadStatusAction` server action with `revalidatePath("/inbox")`

### Frontend / UI

- [x] Create `thread-status.ts` — status constants, labels, type
- [x] Create `ThreadStatusBadge` — colored badge per status
- [x] Create `ThreadCard` — compact card with customer avatar, title, time, assignee, click + drag support
- [x] Create `ThreadList` — Kanban board with 6 status columns, drag-and-drop, optimistic state
- [x] Create `ThreadDetailSheet` — right-side Sheet with thread detail, messages, status actions
- [x] Create `StatusActions` — status change button row
- [x] Create `MessageTimeline` — message list with direction badges
- [x] Create inbox page (`apps/web/src/app/(dashboard)/inbox/page.tsx`) — server component, auth, data fetch

### Wiring

- [x] `ThreadList` manages `selectedId` state, passes to `ThreadDetailSheet`
- [x] `ThreadCard` fires `onClick` (open sheet) and supports HTML5 `draggable`
- [x] Drag-and-drop calls `updateThreadStatusAction` on column drop
- [x] `ThreadDetailSheet` fetches detail via `getThreadDetail` server action on open
- [x] `revalidatePath("/inbox")` in status update action keeps server state in sync

---

## 4. Testing Checklist

### Happy Path

- [x] Board renders 6 columns with correct status labels and thread counts
- [x] Seeded threads appear in correct columns after `db:seed`
- [x] Dragging a card from "New" to "Waiting Review" moves it visually and persists to DB
- [x] Clicking a card opens the detail sheet with thread info and messages
- [x] Status buttons in the sheet update the thread status
- [x] Closing the sheet deselects the card

### Validation

- [ ] `updateThreadStatusAction` rejects invalid status values (Zod enforced)
- [ ] `getThreadDetail` returns `null` for nonexistent thread IDs
- [ ] Intake rejects empty `messageBody` or `customerDisplayName`

### Edge Cases

- [x] Empty columns show "No threads" placeholder
- [ ] Dragging a card to the same column is a no-op (no API call)
- [ ] Rapid consecutive drags don't corrupt state
- [ ] Thread with no `assignedTo` renders unassigned indicator in card

### Auth / Permissions

- [x] Unauthenticated users redirect to `/login`
- [x] All thread/intake procedures verify workspace membership via `assertWorkspaceMember`
- [ ] Users cannot view or modify threads in workspaces they don't belong to

### UI

- [x] Columns scroll vertically independently when content overflows
- [x] Board scrolls horizontally when columns overflow viewport
- [x] Cards show grab cursor on hover, grabbing cursor while dragging
- [x] Drop target column highlights during drag-over
- [x] Detail sheet slides in from right with overlay

### Type Safety / Build

- [x] `npm run type-check` passes with no errors
- [ ] `npm run build` succeeds with no prerender errors
- [ ] `npm run lint` passes

---

## File Map

```
packages/database/prisma/
  thread.schema.prisma          # SupportThread, ThreadMessage models
  customer.schema.prisma        # Customer model
  seed.ts                       # Seed 15 threads across all statuses

packages/types/src/schemas/
  index.ts                      # Zod schemas: ThreadStatus, ListThreads, UpdateThreadStatus, etc.

packages/rest/src/routers/
  thread.ts                     # listByWorkspace, getById, updateStatus, assign
  intake.ts                     # ingestExternalMessage, upsertExternalCustomer, etc.

apps/web/src/
  actions/inbox.ts              # Server actions: getThreadDetail, updateThreadStatusAction
  app/(dashboard)/inbox/
    page.tsx                    # Server component: auth + data fetch + <ThreadList>
    [threadId]/page.tsx         # Legacy detail page (superseded by sheet)
  components/inbox/
    ThreadList.tsx              # Kanban board (client component, drag-and-drop)
    ThreadCard.tsx              # Individual card (draggable, clickable)
    ThreadDetailSheet.tsx       # Right sidebar sheet with thread detail
    StatusActions.tsx           # Status change buttons
    MessageTimeline.tsx         # Message list with direction badges
    ThreadStatusBadge.tsx       # Colored status badge
    thread-status.ts            # Status constants and types
```
