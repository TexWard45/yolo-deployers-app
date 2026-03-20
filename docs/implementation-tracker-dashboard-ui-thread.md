# Implementation Tracker: Dashboard UI for Displaying Threads

This tracker is the execution board for `duc/dashboard-ui-for-displaying-thread`.

## Rules

- Check a box only when code is implemented and pushed in this branch.
- Keep UI-first scope: build thread inbox UX now, keep Discord ingestion behind a stable contract.
- Update this file in the same commit as feature work.

## Phase 0: Planning and Scope Lock

- [x] Confirm UI-first scope and teammate split (you: UI, teammate: Discord ingestion).
- [x] Produce implementation spec for this milestone.
- [x] Confirm status vocabulary for UI (`NEW`, `WAITING_REVIEW`, `WAITING_CUSTOMER`, `ESCALATED`, `IN_PROGRESS`, `CLOSED`).
- [x] Confirm manual intake form is temporary UI test mode.

## Phase 1: Schema / Types Contract

- [x] Add Prisma models for `Customer`, `SupportThread`, `ThreadMessage`.
- [x] Add enums for `ThreadStatus`, `MessageDirection`, and `CustomerSource`.
- [x] Add `Workspace` and `User` relations for thread access and assignment.
- [ ] Create and commit Prisma migration.
- [x] Run `npm run db:generate` and verify exports from `@shared/types`.
- [x] Add Zod schemas in `packages/types/src/schemas/index.ts` for:
- [x] `ListThreadsSchema`
- [x] `GetThreadByIdSchema`
- [x] `UpdateThreadStatusSchema`
- [x] `IngestExternalMessageSchema`
- [x] `UpsertExternalCustomerSchema`

## Phase 2: Backend / API (UI Contract First)

- [x] Create `packages/rest/src/routers/thread.ts` with:
- [x] `listByWorkspace`
- [x] `getById`
- [x] `updateStatus`
- [x] `assign`
- [x] Create `packages/rest/src/routers/message.ts` with:
- [x] `listByThread`
- [x] `createOutgoingDraft` (placeholder)
- [x] Create `packages/rest/src/routers/intake.ts` contract for teammate:
- [x] `upsertExternalCustomer`
- [x] `upsertExternalThread`
- [x] `ingestExternalMessage`
- [x] `touchThreadStatusFromIngestion`
- [x] Register new routers in `packages/rest/src/root.ts`.
- [x] Enforce workspace membership checks in all procedures.

## Phase 3: Frontend / UI

- [x] Add sidebar navigation item: `Inbox`.
- [x] Create `apps/web/src/app/(dashboard)/inbox/page.tsx`.
- [x] Create `apps/web/src/app/(dashboard)/inbox/[threadId]/page.tsx`.
- [x] Create `apps/web/src/components/inbox/ThreadList.tsx`.
- [x] Create `apps/web/src/components/inbox/ThreadCard.tsx`.
- [x] Create `apps/web/src/components/inbox/ThreadFilters.tsx`.
- [x] Create `apps/web/src/components/inbox/ThreadDetail.tsx`.
- [x] Create `apps/web/src/components/inbox/MessageTimeline.tsx`.
- [x] Create `apps/web/src/components/inbox/StatusActions.tsx`.
- [x] Implement loading, empty, and error states for list/detail.

## Phase 4: Wiring and Developer Experience

- [x] Wire server components to `trpc` server caller for initial data.
- [x] Wire client mutations and query invalidation.
- [x] Add temporary manual intake UI (or seed command) for local testing.
- [x] Document ingestion payload contract for teammate handoff.

## Phase 5: Test Setup and Unit Tests

- [ ] Add test framework (recommended: Vitest + Testing Library) for `apps/web`.
- [ ] Add test script in `apps/web/package.json` and ensure root `npm test` executes it.
- [ ] Add first unit tests for status transform/format helpers (pure functions).
- [ ] Add component unit tests for `ThreadFilters` and `ThreadCard`.
- [ ] Add router unit/integration tests for `thread.updateStatus` authorization and transitions.
- [x] Ensure Web CI runs web-scoped tests (`npm run test --workspace @app/web` in `build-web.yml`).

## Phase 6: Validation and Shipping

- [x] Run `npm run type-check`.
- [x] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Update this tracker with final completion state.
- [ ] Open PR to `main` with screenshots/GIF of inbox and thread detail flows.

## Live Notes

- `2026-03-20`: Tracker created; ready to start implementation on this branch.
- `2026-03-20`: Added execution plan doc and enabled web-scoped test command in Web CI.
- `2026-03-20`: Implemented initial inbox schema, routers, pages, and UI components.
- `2026-03-20`: `db:generate`, `type-check`, and `lint` pass; `@app/web` production build currently fails in restricted network due Google Fonts fetch (`Geist`).
- `2026-03-20`: `db:migrate` blocked in this environment because Prisma migrate requires configured datasource URL.
- `2026-03-20`: Added Discord integration handoff doc with payload mapping and server-side usage contract.
