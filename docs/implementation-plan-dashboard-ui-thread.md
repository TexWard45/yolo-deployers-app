# Implementation Plan: Dashboard UI for Displaying Threads

Branch: `duc/dashboard-ui-for-displaying-thread`

This plan is execution-focused and maps directly to small, reviewable commits.

## 1) Scope for This Branch

1. Build UI-first inbox/thread experience in dashboard.
2. Provide backend contract for future Discord ingestion.
3. Add meaningful unit testing and include it in Web CI.
4. Do not block on live Discord integration.

## 2) Milestones (Commit-Sized)

### Milestone A: Foundation Data Contract

1. Add Prisma enums/models:
   - `Customer`
   - `SupportThread`
   - `ThreadMessage`
2. Add relations on `Workspace` and `User`.
3. Add migration and regenerate Prisma types.
4. Add Zod schemas for thread list/detail/status and ingestion payloads.

Exit criteria:
1. `npm run db:migrate` succeeds.
2. `npm run db:generate` succeeds.
3. `npm run type-check` still passes for shared packages.

### Milestone B: API Contract (UI + Teammate Integration)

1. Add `thread` router with list/detail/update/assign.
2. Add `message` router with list and draft placeholder.
3. Add `intake` router contract for teammate:
   - `upsertExternalCustomer`
   - `upsertExternalThread`
   - `ingestExternalMessage`
4. Register routers in root app router.
5. Enforce workspace membership authorization.

Exit criteria:
1. Router procedures compile and are callable via `trpc` types.
2. Unauthorized access returns `FORBIDDEN`.
3. Duplicate external message IDs are idempotent.

### Milestone C: Inbox UI Shell

1. Add sidebar nav link for Inbox.
2. Build `/inbox` page with:
   - Thread list
   - Status filters
   - Empty/loading/error states
3. Build `/inbox/[threadId]` page with:
   - Message timeline
   - Status actions
   - Basic assignment surface

Exit criteria:
1. Operator can browse and open threads.
2. Operator can change thread status and see updates.
3. UI remains responsive on desktop and mobile.

### Milestone D: UI Wiring + Local Demo Intake

1. Wire server components to server `trpc` caller.
2. Wire client mutations + cache invalidation.
3. Add temporary manual intake path for local data creation.
4. Document teammate ingestion contract (payload examples).

Exit criteria:
1. End-to-end local flow works with manual intake.
2. Same UI works with mocked ingestion events.

### Milestone E: Unit Tests + CI Gate

1. Set up test stack in `apps/web` (Vitest + Testing Library).
2. Replace placeholder web test script with real tests.
3. Add tests for:
   - status helper functions
   - `ThreadFilters` and `ThreadCard` behavior
4. Add backend tests for status transition/authorization logic (where feasible).
5. Ensure Web CI runs `npm run test --workspace @app/web`.

Exit criteria:
1. `npm run test --workspace @app/web` passes locally.
2. Web CI executes the same command.

## 3) Suggested Commit Sequence

1. `feat(db): add customer/thread/message schema + migration`
2. `feat(types): add thread and ingestion zod schemas`
3. `feat(api): add thread/message/intake routers`
4. `feat(ui): add inbox routes and base components`
5. `feat(ui): wire status mutations and detail timeline`
6. `test(web): add vitest + testing-library + initial unit tests`
7. `ci(web): enforce @app/web unit tests in build-web workflow`
8. `docs: add teammate ingestion payload contract examples`

## 4) Risks and Mitigations

1. Risk: schema churn before teammate integration.
   - Mitigation: lock ingestion payload contract early and version it in docs.
2. Risk: no existing test setup in web app.
   - Mitigation: add test framework before expanding UI complexity.
3. Risk: status transitions become inconsistent.
   - Mitigation: centralize transition validation in one backend helper.

## 5) Definition of Done

1. Inbox + thread detail pages are production-usable with local/manual data.
2. API contract is ready for Discord ingestion without UI refactor.
3. Unit tests exist and run in Web CI.
4. `type-check`, `lint`, `test`, and `build` all pass.
