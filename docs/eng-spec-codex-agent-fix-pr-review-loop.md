# Engineering Spec: Codex Agent Fix PR Review Loop

## 1. Job to Be Done

- **Who**: Support engineers and workspace admins triaging customer issues in the inbox.
- **What**: Trigger a Codex-powered fix workflow that opens a GitHub PR, runs AI review + CI checks, applies follow-up fixes, and repeats until the PR is ready.
- **Why**: The current flow stops at analysis/spec and still requires manual IDE work + manual review cycles. This feature closes the loop from support issue to review-ready PR.
- **Success criteria**:
  - User clicks `Generate Fix PR` from a thread with a completed `ThreadAnalysis`.
  - An RCA sub-step pulls Sentry evidence (issues + stack traces) and links probable failing code paths before fix generation.
  - A Temporal workflow (Codex task queue) creates/updates a GitHub PR with iterative commits.
  - The loop runs `fix -> review -> checks -> fix` until pass or max iterations.
  - Final status + PR URL are saved and visible in triage history.
  - Workspace-level controls exist for GitHub credentials, model selection, and max loop iterations.

## 2. Proposed Flow / Architecture

### Data model changes

1. Update `packages/database/prisma/support.schema.prisma`:
   - Extend `TriageActionType` with `GENERATE_FIX_PR`.
2. Add persistent run tracking models (new, support domain):
   - `FixPrRun`
     - `id`, `workspaceId`, `threadId`, `analysisId`, `createdById`
     - `status` enum: `QUEUED | RUNNING | WAITING_REVIEW | PASSED | FAILED | CANCELLED`
     - `prUrl`, `prNumber`, `branchName`, `headSha`
     - `iterationCount`, `maxIterations`, `lastError`, `summary`
     - `rcaSummary`, `rcaConfidence`, `rcaSignals` (JSON: sentry issue IDs, culprit files, stack frames)
     - `createdAt`, `updatedAt`
   - `FixPrIteration`
     - `id`, `runId`, `iteration`, `status`
     - `fixPlan`, `reviewFindings`, `checkResults`, `appliedFiles`
     - `startedAt`, `completedAt`
3. Extend `WorkspaceAgentConfig` in `packages/database/prisma/support.schema.prisma`:
   - GitHub config:
     - `githubToken` (encrypted-at-rest pattern same as existing secrets)
     - `githubDefaultOwner`
     - `githubDefaultRepo`
     - `githubBaseBranch` (default `main`)
   - Codex loop config:
     - `codexFixModel` (default `gpt-5.4-codex`)
     - `codexReviewModel` (default `gpt-5.4-codex`)
     - `codexFixMaxIterations` (default `3`)
     - `codexRequiredCheckNames` (`String[]`)
4. Run migration + generated types:
   - `npm run db:migrate`
   - `npm run db:generate`

### API layer

1. Add Zod schemas in `packages/types/src/schemas/index.ts`:
   - `GenerateFixPRSchema`
   - `GenerateFixPRWorkflowInputSchema`
   - `GetFixPRStatusSchema`
   - `CancelFixPRSchema`
   - `SaveFixPRProgressSchema` (for internal queue->web persistence endpoint)
2. Extend `packages/rest/src/routers/agent.ts`:
   - `generateFixPR` mutation:
     - validate workspace membership
     - validate thread/analysis linkage
     - validate GitHub + model config
     - create `FixPrRun` row (`QUEUED`)
     - dispatch Temporal workflow with idempotent `workflowId` (`fix-pr-${analysisId}`)
   - `getFixPRStatus` query:
     - returns latest run + iteration summaries + PR link
   - `cancelFixPR` mutation:
     - marks run cancelled and requests workflow cancellation
3. Add Temporal dispatch in `packages/rest/src/temporal.ts`:
   - `dispatchGenerateFixPRWorkflow(input)` targeting `CODEX_TASK_QUEUE` (Codex worker)
4. Add helper modules under `packages/rest/src/routers/helpers/`:
   - `github-client.ts` (`createBranch`, `upsertFiles`, `createOrUpdatePullRequest`, `getChecks`)
   - `fix-pr-rca.prompt.ts` (RCA agent prompt: analysis + Sentry + codex context -> ranked root cause hypotheses)
   - `codex-fix.prompt.ts` (structured patch proposal)
   - `codex-review.prompt.ts` (severity-ranked review findings)
   - `fix-pr-assembler.ts` (merge analysis + codex chunks + sentry findings -> agent context)
5. Add internal persistence endpoint in web app:
   - `apps/web/src/app/api/rest/fix-pr/progress/route.ts`
   - validates `x-internal-secret` and proxies to `trpc.agent.saveFixPRProgress` (or direct protected mutation)

### Frontend

1. `apps/web/src/actions/inbox.ts`:
   - add `generateFixPRAction`, `getFixPRStatusAction`, `cancelFixPRAction`
2. `apps/web/src/components/inbox/TriageSection.tsx`:
   - add `Generate Fix PR` button
   - show loop state (`Queued`, `Iteration 2/3`, `Waiting checks`, `Passed`, `Failed`)
   - show PR link and latest reviewer summary
3. `apps/web/src/app/workspace/[slug]/settings/settings-form.tsx`:
   - add GitHub + Codex loop config inputs
   - redact token in reads (same pattern as `linearApiKey`/`sentryAuthToken`)
4. Keep server/client boundaries:
   - mutations via server actions
   - polling status from client component (`useEffect` interval)

### Parent / child agent topology

The clean design is: Temporal owns orchestration, the parent Codex thread owns decisions, and child Codex threads do bounded specialist work. Only one fixer thread writes code.

```text
User/UI
  |
  v
+----------------------+
| apps/web             |
| generateFixRun()     |
| auth + workspace     |
| create FixPrRun row  |
+----------+-----------+
           |
           v
+-------------------------------+
| Temporal Orchestrator         |
| apps/codex workflow           |
| generateFixPRWorkflow         |
+---------------+---------------+
                |
                v
      +----------------------+
      | Parent Codex Thread  |
      | team leader          |
      | owns run memory      |
      +----+-----------+-----+
           |           |
           | fork      | fork
           |           |
           v           v
+----------------+   +----------------------+
| rca-agent      |   | code-context-agent   |
| summary        |   | expand codex chunks  |
| sentry issues  |   | related files        |
| root cause     |   | symbols/imports      |
+--------+-------+   +----------+-----------+
         |                      |
         +----------+-----------+
                    |
                    | fork
                    v
         +----------------------+
         | test-agent           |
         | pick checks/tests    |
         | suggest commands     |
         +----------+-----------+
                    |
                    v
      +-------------------------------+
      | Parent Codex Thread           |
      | merge RCA + code + test plan  |
      +---------------+---------------+
                      |
                      | fork/start
                      v
            +----------------------+
            | fixer-agent          |
            | generate/apply code  |
            | produce patch        |
            +----------+-----------+
                       |
                       v
            +----------------------+
            | workspace / sandbox  |
            | files updated        |
            +----------+-----------+
                       |
                       +-------------------+
                       |                   |
                       v                   v
            +----------------------+   +----------------------+
            | reviewer-agent       |   | checks-agent         |
            | review diff          |   | run tests / lint     |
            | blockers / risks     |   | inspect failures     |
            +----------+-----------+   +----------+-----------+
                       |                          |
                       +------------+-------------+
                                    |
                                    v
                      +-----------------------------+
                      | Parent Codex Thread         |
                      | decide:                     |
                      | - PASS                      |
                      | - ITERATE                   |
                      | - STOP / handoff            |
                      +-------------+---------------+
                                    |
                                    v
                      +-----------------------------+
                      | Persist FixPrRun state      |
                      | + optional GitHub PR step   |
                      +-----------------------------+
```

### Codex skills and agent contracts

Use explicit Codex skills for the bounded specialist roles instead of one giant system prompt. Skills should live under `.codex/skills/` so the behavior is versioned with the repo and stays consistent across runs.

Suggested skills:

1. `.codex/skills/fix-pr-rca/SKILL.md`
   - purpose: analyze thread summary + Sentry evidence + codex hits
   - output: ranked root-cause hypotheses with confidence and evidence
2. `.codex/skills/fix-pr-code-context/SKILL.md`
   - purpose: expand codex hits into concrete files, symbols, imports, and adjacent code
   - output: bounded edit scope and related code graph
3. `.codex/skills/fix-pr-test-selector/SKILL.md`
   - purpose: select the minimum useful tests/checks/commands for the suspected fix area
   - output: ordered command list with rationale
4. `.codex/skills/fix-pr-fixer/SKILL.md`
   - purpose: produce the smallest viable patch that resolves the RCA and preserves repo patterns
   - output: structured patch plan and changed files summary
5. `.codex/skills/fix-pr-reviewer/SKILL.md`
   - purpose: review the produced diff like a strict code reviewer
   - output: blockers, regression risks, missing tests, approval boolean

The `fix-pr-reviewer` skill should be opinionated and narrow:
- focus on behavioral regressions, incorrect assumptions, missing tests, data safety, and mismatch with RCA
- avoid style-only comments unless they hide a correctness issue
- return machine-readable findings grouped into `blocker`, `warning`, or `note`
- force explicit `approved: true | false`

### Forked agent behavior

Each forked agent should be bounded by a typed input, limited tool access, a strict output contract, and a stop condition. The parent thread should reject freeform outputs and only merge structured artifacts.

#### `rca-agent`

- input:
  - thread summary
  - latest `ThreadAnalysis`
  - Sentry findings from `fetchSentryContext`
  - top codex chunks already attached to the analysis
- tools:
  - Sentry evidence payload only
  - no file writes
- output:
  - `summary`
  - `hypotheses[]`
  - `confidence`
  - `likelyFiles[]`
  - `evidence[]` with issue IDs, culprit, stack frames
- stop condition:
  - returns top 1-3 likely causes with evidence, or `insufficient_evidence`

#### `code-context-agent`

- input:
  - `rca-agent` output
  - codex chunk IDs / file paths
- tools:
  - codex chunk detail/context lookups
  - read-only file context expansion
- output:
  - `files[]`
  - `symbols[]`
  - `relatedChunks[]`
  - `editScope`
- stop condition:
  - enough concrete edit targets exist for a fixer to act without broad repo search

#### `test-agent`

- input:
  - `rca-agent` output
  - `code-context-agent` output
  - workspace/build metadata if needed
- tools:
  - read-only repo inspection
  - command suggestions only in phase 1
- output:
  - `commands[]`
  - `requiredChecks[]`
  - `rationale`
- stop condition:
  - returns an ordered, minimal command plan

#### `fixer-agent`

- input:
  - merged RCA packet
  - bounded code context
  - test plan
  - prior reviewer/check failures on iteration `n > 1`
- tools:
  - workspace write sandbox
  - patch/apply tools
  - optional shell for repo-aware edits
- output:
  - `summary`
  - `changedFiles[]`
  - `patchPlan`
  - `riskNotes[]`
- stop condition:
  - patch is generated and applied, or agent returns `cannot_fix_safely`

#### `reviewer-agent`

- input:
  - diff from fixer iteration
  - original RCA packet
  - test plan
- tools:
  - review mode or read-only diff inspection
  - no file writes
- output:
  - `approved`
  - `blockers[]`
  - `warnings[]`
  - `notes[]`
  - `missingTests[]`
- stop condition:
  - returns approval decision and concise rationale

#### `checks-agent`

- input:
  - changed files
  - test plan commands
  - workspace path / sandbox
- tools:
  - `command/exec`
  - stdout/stderr capture
- output:
  - `passed`
  - `commandsRun[]`
  - `failures[]`
  - `logs[]`
- stop condition:
  - all commands completed, timed out, or failed

### Parent merge rules

The parent thread should merge child outputs with deterministic precedence:

1. `rca-agent` defines the problem statement and candidate fix scope.
2. `code-context-agent` can narrow or expand files, but cannot override the root cause.
3. `test-agent` defines the validation plan.
4. `fixer-agent` may only edit inside the approved scope unless it explicitly requests scope expansion.
5. `reviewer-agent` can block the iteration.
6. `checks-agent` can block the iteration.
7. Only the parent thread decides `PASS`, `ITERATE`, or `HANDOFF`.

### Temporal implementation plan

Implement this in Temporal as one parent workflow with deterministic stages and activity-driven Codex calls. Do not make agent spawning implicit; the workflow should decide the graph.

1. Web entrypoint
   - `apps/web` button calls `generateFixPRAction`
   - `packages/rest/src/routers/agent.ts` validates auth/config and creates `FixPrRun`
   - `packages/rest/src/temporal.ts` dispatches `generateFixPRWorkflow`
2. Workflow registration
   - add `generateFixPRWorkflow` to `apps/codex/src/workflows/registry.ts`
   - export it from `apps/codex/src/workflows/index.ts`
   - keep it on `CODEX_TASK_QUEUE`, separate from the support queue
3. Activity module layout
   - add `apps/codex/src/activities/generate-fix-pr.activity.ts`
   - export each bounded activity from `apps/codex/src/activities/index.ts`
   - suggested activities:
     - `getFixRunContext`
     - `startParentCodexThread`
     - `runRcaAgent`
     - `runCodeContextAgent`
     - `runTestAgent`
     - `runFixerAgent`
     - `applyWorkspacePatch`
     - `runReviewerAgent`
     - `runChecksAgent`
     - `saveFixRunProgress`
4. Parent workflow shape
   - Step 1: load run context from DB or via web REST callback pattern
   - Step 2: create parent Codex thread for the run
   - Step 3: fan out RCA + code-context in parallel
   - Step 4: run test-agent after code-context returns
   - Step 5: merge specialist outputs into one normalized artifact
   - Step 6: loop `1..maxIterations`
   - Step 7: call fixer-agent, apply patch, run reviewer + checks in parallel
   - Step 8: decide pass / iterate / stop
   - Step 9: persist final state and create `TriageAction`
5. Deterministic workflow rule
   - the workflow should store only IDs and structured results
   - all nondeterministic work stays in activities: Codex app-server calls, shell commands, Sentry fetches, filesystem edits, GitHub API calls
6. Codex app-server integration
   - activities call Codex app-server methods
   - parent thread: `thread/start`, `turn/start`, `thread/resume`
   - specialist threads: `thread/fork` from the parent thread
   - reviewer stage: `review/start` or a dedicated reviewer thread if custom prompting is needed
   - checks stage: `command/exec` for local test commands in the sandbox
7. Persistence pattern
   - follow the existing queue->web pattern already used by analysis save routes
   - use `apps/web/src/app/api/rest/fix-pr/progress/route.ts`
   - validate `x-internal-secret`
   - save iteration-level artifacts incrementally so UI polling is live
8. Failure handling
   - retry external activities with bounded retries
   - if RCA or checks time out, record degraded mode instead of failing the whole run immediately
   - if fixer output is invalid, mark iteration failed and stop with human handoff
9. Cancellation
   - `cancelFixPR` marks run as cancelled
   - workflow checks cancellation before each major stage and before each loop iteration
10. Phase 1 delivery cut
   - first ship code generation + review + local checks
   - keep GitHub PR creation optional or stubbed
   - that keeps the core loop working before adding external PR automation

### Temporal sequence details

Map the agent forks cleanly onto Temporal activities and workflow loops:

1. `getFixRunContext`
   - fetch thread, analysis, workspace config, and existing run state
2. `startParentCodexThread`
   - create the leader thread and save `parentThreadId` on the run
3. Parallel fan-out
   - `runRcaAgent(parentThreadId, input)`
   - `runCodeContextAgent(parentThreadId, input)`
4. Dependent fork
   - `runTestAgent(parentThreadId, { rca, codeContext })`
5. `saveFixRunProgress`
   - persist specialist outputs before the write path starts
6. Iteration loop
   - `runFixerAgent(parentThreadId, mergedPacket, iteration)`
   - `applyWorkspacePatch(runId, fixerOutput)`
   - parallel:
     - `runReviewerAgent(parentThreadId, diff, mergedPacket, iteration)`
     - `runChecksAgent(runId, commandPlan, iteration)`
7. `saveFixRunProgress`
   - persist reviewer/check results after every iteration
8. Parent decision gate
   - if reviewer approved and checks passed -> finalize
   - else if iteration < maxIterations -> resume parent thread with failure artifacts and continue
   - else -> mark `WAITING_REVIEW`

The important constraint is that the Temporal workflow only sees typed artifacts and IDs. Codex threads, shell execution, filesystem changes, and network I/O all stay inside activities.

### Detailed implementation plan

Build this in phases so each step leaves the system in a runnable state and reuses the current repo patterns instead of introducing a second orchestration style.

#### Phase 0: Contracts first

Goal: make the data model and API contracts real before any agent logic exists.

1. Add Prisma models and enums in `packages/database/prisma/support.schema.prisma`
   - `TriageActionType.GENERATE_FIX_PR`
   - `FixPrRun`
   - `FixPrIteration`
   - new `WorkspaceAgentConfig` fields
2. Create migration and regenerate Prisma output
   - `npm run db:migrate`
   - `npm run db:generate`
3. Add shared schemas in `packages/types/src/schemas/index.ts`
   - run input
   - progress payload
   - typed specialist outputs
   - typed reviewer/check results
4. Add redacted config defaults in `packages/rest/src/routers/agent.ts`
   - extend `getWorkspaceConfig`
   - extend `updateWorkspaceConfig`

Exit criteria:
- database compiles
- types compile
- workspace settings can round-trip the new config fields

#### Phase 1: Run creation and status plumbing

Goal: user can click a button, create a run, and see status in the UI even before real Codex work exists.

1. Add `generateFixPR`, `getFixPRStatus`, `cancelFixPR`, `saveFixPRProgress` to `packages/rest/src/routers/agent.ts`
2. Add `dispatchGenerateFixPRWorkflow` to `packages/rest/src/temporal.ts`
3. Add `apps/web/src/app/api/rest/fix-pr/progress/route.ts`
4. Add server actions in `apps/web/src/actions/inbox.ts`
5. Add status UI and polling in `apps/web/src/components/inbox/TriageSection.tsx`

Initial behavior:
- workflow can be a stub
- status can move `QUEUED -> RUNNING -> FAILED/PASSED`
- UI proves end-to-end request, persistence, and polling

Exit criteria:
- button creates a run
- status renders in the inbox
- cancellation flips run state

#### Phase 2: Codex workflow skeleton

Goal: wire the `apps/codex` worker to own the run lifecycle.

1. Add `generateFixPRWorkflow` in `apps/codex/src/workflows/generate-fix-pr.workflow.ts`
2. Register/export it in `apps/codex/src/workflows/registry.ts` and `apps/codex/src/workflows/index.ts`
3. Add `apps/codex/src/activities/generate-fix-pr.activity.ts`
4. Export activities from `apps/codex/src/activities/index.ts`
5. Implement these first activities as stubs:
   - `getFixRunContext`
   - `startParentCodexThread`
   - `saveFixRunProgress`

Exit criteria:
- `npm run dev:codex` starts the worker
- workflow is dispatchable on `CODEX_TASK_QUEUE`
- run records show `parentThreadId` and stage transitions

#### Phase 3: Read-only specialists

Goal: make the parent thread collect structured evidence before any code editing begins.

1. Implement `runRcaAgent`
   - use analysis + Sentry evidence
   - no writes
2. Implement `runCodeContextAgent`
   - use existing codex chunks and codex context expansion
   - no writes
3. Implement `runTestAgent`
   - propose local commands and required checks
4. Persist each artifact through `saveFixRunProgress`

Exit criteria:
- parent thread has specialist outputs
- UI can show RCA summary and planned checks
- no code is changed yet

#### Phase 4: Single-writer fix loop

Goal: make one fixer produce and apply code changes safely.

1. Implement `runFixerAgent`
   - consume merged RCA packet + code context + test plan
2. Implement `applyWorkspacePatch`
   - apply edits in sandbox/workspace
   - record changed files
3. Store iteration artifacts on `FixPrIteration`
4. Keep PR/GitHub optional in this phase

Exit criteria:
- local files can be changed by the workflow
- each iteration records what changed
- out-of-scope edits are rejected

#### Phase 5: Review and checks gate

Goal: stop treating “code generated” as success and enforce a real quality gate.

1. Implement `runReviewerAgent`
   - use `review/start` or review-thread pattern
   - return blockers/warnings/approval
2. Implement `runChecksAgent`
   - execute selected commands
   - capture logs/failures
3. Add parent decision gate
   - pass
   - iterate
   - handoff after `maxIterations`

Exit criteria:
- run only passes if reviewer approves and checks pass
- failed checks feed the next iteration

#### Phase 6: GitHub integration

Goal: move from local fix loop to draft-PR workflow without changing the core run model.

1. Add `github-client.ts`
2. Create/update draft PR after the first successful patch application
3. Push later iterations to the same branch/PR
4. Persist `prUrl`, `prNumber`, `branchName`, `headSha`

Exit criteria:
- same run model works with or without GitHub
- PR link shows in the triage UI

#### Phase 7: Hardening and operations

Goal: make the feature safe for multiple users and workspaces.

1. Add workspace-level concurrency guardrails
2. Add timeouts and bounded retries per external activity
3. Add richer cancellation handling
4. Add degraded-mode status for missing Sentry or missing GitHub
5. Add audit metadata for each iteration decision

Exit criteria:
- one noisy workspace cannot starve others
- failures degrade cleanly instead of corrupting runs

### Flow diagram

1. User clicks `Generate Fix PR` in `TriageSection`.
2. `agent.generateFixPR` validates auth/config/analysis and creates `FixPrRun`.
3. API dispatches `generateFixPRWorkflow` to Codex Temporal queue.
4. Workflow starts the parent Codex thread and loads context: thread messages, `ThreadAnalysis`, codex chunk context, sentry findings, workspace config.
5. Child specialist threads run:
   - queries Sentry using existing `WorkspaceAgentConfig` Sentry credentials
   - ranks likely root causes with confidence + evidence (stack frames, culprits, recurrence)
   - expands related files/symbols from codex chunks
   - proposes tests/checks to run for this issue
6. Parent thread merges specialist outputs into one structured fix packet.
7. Workflow creates/updates branch `fix/{threadId}-{slug}` and opens/updates a draft PR.
8. Iteration step (`i = 1..maxIterations`):
   - Codex Fixer proposes minimal file edits.
   - Fixer prompt includes RCA output as required context, not optional context.
   - Activity applies edits to branch and pushes commit.
   - Codex Reviewer analyzes diff and emits findings (blockers vs nits).
   - Checks activity polls GitHub check-runs/statuses.
9. Decision:
   - if blockers or failing required checks: loop continues with reviewer/check feedback included in next fixer prompt.
   - if no blockers and required checks pass: mark run `PASSED`.
10. On max iterations without pass: mark run `WAITING_REVIEW` and keep PR open for human takeover.
11. Save final outcome to `TriageAction` (`GENERATE_FIX_PR`) with `prUrl` + loop metadata.
12. UI polling displays live progress and final PR status in triage history.

### Dependencies

- New package:
  - `@octokit/rest` in `packages/rest` (branch/commit/PR/check-runs).
- Existing services used:
  - OpenAI/Codex model API for fixer/reviewer.
  - Temporal (existing infra) with Codex queue worker.
  - GitHub API.
  - Sentry API via existing `fetchSentryContext` helper (RCA evidence stage).
- Env and config:
  - Reuse `INTERNAL_API_SECRET` for queue->web callbacks.
  - Keep workspace-specific GitHub credentials on `WorkspaceAgentConfig` (do not expose to client).

## 3. Task Checklist

### Delivery order

- [x] Phase 0: ship schema, Zod contracts, and settings plumbing first
- [x] Phase 1: ship run creation, status API, and inbox polling next
- [x] Phase 2: ship the codex workflow skeleton and parent thread bootstrapping
- [x] Phase 3: ship read-only specialist agents before any write path exists
- [x] Phase 4: ship fixer + patch application with no GitHub dependency
- [x] Phase 5: ship reviewer + checks gating before declaring the loop complete
- [ ] Phase 6: ship draft-PR creation and branch updates last
- [ ] Phase 7: ship retries, concurrency limits, cancellation, and degraded-mode handling

Current implementation status:

- [x] Local fix-loop scaffold is in place through `fix -> review -> checks`, with persisted run/iteration state.
- [x] Automated quality gates are green: unit tests, e2e-style router tests, lint, typecheck, and build.
- [ ] Real Codex app-server thread/fork/review orchestration is not wired yet.
- [ ] Real GitHub branch/commit/draft-PR automation is not wired yet.
- [ ] Manual end-to-end validation against local Temporal/Postgres/web/codex workers is not done yet.

### Schema / Data

- [x] Add `GENERATE_FIX_PR` to `TriageActionType` in `packages/database/prisma/support.schema.prisma`
- [x] Add `FixPrRun` and `FixPrIteration` models in `packages/database/prisma/support.schema.prisma`
- [x] Add GitHub and Codex loop fields to `WorkspaceAgentConfig` in `packages/database/prisma/support.schema.prisma`
- [x] Add fields for `parentThreadId`, latest stage, and iteration summaries if needed for UI polling
- [x] Create and commit Prisma migration in `packages/database/prisma/migrations/` (generated manually here because no reachable local/shadow Postgres was available for `prisma migrate dev`)
- [x] Regenerate Prisma types via `npm run db:generate`
- [x] Add run input/status/progress schemas in `packages/types/src/schemas/index.ts`
- [x] Add typed outputs for `rca-agent`, `code-context-agent`, `test-agent`, `fixer-agent`, `reviewer-agent`, and `checks-agent`

### Backend / API

- [x] Add `generateFixPR`, `getFixPRStatus`, and `cancelFixPR` procedures to `packages/rest/src/routers/agent.ts`
- [x] Add `saveFixPRProgress` mutation or protected procedure in `packages/rest/src/routers/agent.ts`
- [x] Extend `getWorkspaceConfig` to return redacted GitHub/Codex loop fields
- [x] Extend `updateWorkspaceConfig` to persist GitHub/Codex loop fields
- [x] Add `dispatchGenerateFixPRWorkflow` to `packages/rest/src/temporal.ts` with idempotent workflow ID
- [ ] Add `github-client.ts` helper in `packages/rest/src/routers/helpers/` with full branch/commit/PR/check wrappers
- [ ] Current gap: the helper only covers draft PR creation and check listing, not branch/file update flows
- [x] Add `fix-pr-rca.prompt.ts` helper in `packages/rest/src/routers/helpers/` and structured RCA output types
- [x] Add `fix-pr-code-context.prompt.ts` helper or equivalent typed prompt builder for file/symbol expansion
- [x] Add `fix-pr-test-selector.prompt.ts` helper or equivalent typed prompt builder for validation planning
- [x] Add `codex-fix.prompt.ts` and `codex-review.prompt.ts` with strict structured output contracts
- [x] Install `@octokit/rest` in `packages/rest`

### Codex Skills

- [x] Add `.codex/skills/fix-pr-rca/SKILL.md` for Sentry-backed RCA output
- [x] Add `.codex/skills/fix-pr-code-context/SKILL.md` for bounded file/symbol expansion
- [x] Add `.codex/skills/fix-pr-test-selector/SKILL.md` for test/check selection
- [x] Add `.codex/skills/fix-pr-fixer/SKILL.md` for minimal patch generation
- [x] Add `.codex/skills/fix-pr-reviewer/SKILL.md` for blocker-focused code review
- [x] Define shared JSON output contracts used by all skills so parent thread merges are deterministic

### Frontend / UI

- [x] Add `generateFixPRAction`, `getFixPRStatusAction`, `cancelFixPRAction` in `apps/web/src/actions/inbox.ts`
- [x] Add `Generate Fix PR` button + loop status UI in `apps/web/src/components/inbox/TriageSection.tsx`
- [x] Render stage-specific states like `Collecting RCA`, `Building Fix`, `Running Review`, `Running Checks`, `Waiting Review`
- [x] Show latest reviewer blocker summary and last failed command summary in the UI
- [x] Render `GENERATE_FIX_PR` rows in triage history with PR URL and iteration summary
- [x] Extend `apps/web/src/app/workspace/[slug]/settings/settings-form.tsx` with GitHub + loop config inputs

### Wiring

- [x] Add `apps/web/src/app/api/rest/fix-pr/progress/route.ts` with `x-internal-secret` validation
- [x] Add parent-thread and specialist-thread result types to `packages/types/src/schemas/index.ts`
- [x] Implement `apps/codex/src/workflows/generate-fix-pr.workflow.ts` for `fix -> review -> checks` loop
- [x] Implement `apps/codex/src/activities/generate-fix-pr.activity.ts` for context, parent thread, RCA, code-context, test selection, patch apply, review, checks, persistence callbacks
- [x] Export/register workflow in `apps/codex/src/workflows/index.ts` and `apps/codex/src/workflows/registry.ts`
- [x] Export/register activities in `apps/codex/src/activities/index.ts`
- [x] Ensure dispatch from web uses `CODEX_TASK_QUEUE` (not default support queue)
- [ ] Integrate Codex app-server calls inside activities only, not inside workflow code
- [x] Save progress after every major stage so UI polling never waits for full workflow completion
- [x] Gate phase 1 so GitHub remains optional while the local fix loop is being built

### Cleanup

- [x] Update `apps/web/src/actions/agent-settings.ts` and `getWorkspaceConfig` defaults/redaction for new config fields
- [x] Add/adjust shared exports if needed in `packages/rest/src/index.ts` and `packages/types/src/index.ts`
- [ ] Update `CLAUDE.md` sections for the new Codex fix-review workflow and ownership boundaries
- [x] Run `npm run lint`, `npm run type-check`, and `npm run build`

### Code Quality

- [x] Refactor router and activity logic into smaller helpers where the first pass was too dense
- [x] Preserve redacted secrets on settings save instead of overwriting stored credentials with placeholder values
- [x] Harden workspace patch application against repo-root escape and ambiguous multi-match replacements
- [x] Validate structured LLM outputs with shared Zod schemas before they enter workflow state
- [x] Add unit coverage for helper fallback behavior and codex patch safety
- [x] Add e2e-style router tests for run lifecycle, persistence, and permissions

## 4. Testing Checklist

### Happy path

- [ ] Trigger `Generate Fix PR` on analyzed thread and verify run is created and workflow starts
- [ ] Verify parent thread ID and child specialist artifacts are persisted on the run
- [ ] Verify draft PR is created and updated with iteration commits
- [ ] Verify RCA stage records top Sentry-backed hypothesis with evidence (issue ID + stack frames + mapped file paths)
- [ ] Verify loop converges to `PASSED` when reviewer has no blockers and required checks are green
- [ ] Verify `TriageAction` stores `action=GENERATE_FIX_PR` and `prUrl`

### Validation

- [x] Reject when user is not a workspace member (`FORBIDDEN`) via router test coverage
- [ ] Reject when analysis/thread/workspace mismatch (`NOT_FOUND`/`BAD_REQUEST`)
- [ ] If GitHub automation is enabled in Phase 6, reject incomplete `githubToken/owner/repo` config before PR creation
- [ ] If Sentry config is absent, workflow continues with code-only RCA and records `rca_source=analysis_only`
- [ ] Reject malformed queue callback payloads on `/api/rest/fix-pr/progress`

### Edge cases

- [ ] Re-click while run active should no-op due to idempotent workflow ID
- [ ] Branch already exists should reuse/update instead of failing hard
- [ ] `code-context-agent` returning oversized scope should be narrowed by parent before fixer runs
- [ ] `fixer-agent` requesting out-of-scope edits should require explicit parent approval or fail the iteration
- [ ] Reviewer returns empty/invalid findings should fail iteration safely and continue with guardrails
- [ ] Sentry API timeout/error should degrade gracefully (no hard fail) and continue using analysis + codex context
- [ ] Required checks never complete should timeout and mark run `WAITING_REVIEW`
- [ ] Max iterations reached should stop loop cleanly with actionable summary
- [ ] GitHub API rate limiting should retry with backoff and preserve run state

### Auth / Permissions

- [ ] Only workspace members can trigger/cancel/view fix runs
- [ ] Only OWNER/ADMIN can update workspace GitHub/Codex loop config
- [ ] `githubToken` never returned plaintext from `getWorkspaceConfig`
- [ ] Internal progress endpoint rejects missing/invalid `x-internal-secret`

### UI

- [ ] `Generate Fix PR` button shows loading/disabled state while dispatching
- [ ] Status panel updates from polling without page refresh
- [ ] Error state shows clear reason when run fails
- [ ] PR link opens correctly and history label reflects final state (`Passed`, `Waiting Review`, `Failed`)
- [ ] Settings form handles token redaction and save/update flows correctly

### Type safety

- [x] `npm run type-check` passes across all workspaces
- [x] Zod schemas and inferred types are reused in router, actions, and workflow input/output contracts

### Automated Tests

- [x] `npm test` passes for the branch
- [x] Router tests cover fix-run lifecycle and workspace-membership rejection
- [x] Unit tests cover code-context expansion, test selection, GitHub helper basics, and LLM fallback behavior
- [x] Codex worker tests cover repo-root command execution and safe patch application

### Lint

- [x] `npm run lint` passes with one pre-existing Next.js `<img>` warning outside this change set and no new errors

### Build

- [x] `npm run build --workspace @app/web` succeeds
- [x] `npm run build --workspace @app/codex` succeeds
- [x] `npm run build` monorepo build succeeds without prerender/runtime errors

### Manual test plan

#### Local bring-up

- [ ] Start local infra with `docker compose up postgres temporal`
- [ ] Apply schema changes with `npm run db:migrate`
- [ ] Regenerate types with `npm run db:generate`
- [ ] Start web app with `npm run dev:web`
- [ ] Start codex worker with `npm run dev:codex`
- [ ] Confirm `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `CODEX_TASK_QUEUE`, and `INTERNAL_API_SECRET` are set

#### Manual scenario A: run creation and polling

- [ ] Open a thread with an existing `ThreadAnalysis`
- [ ] Click `Generate Fix PR`
- [ ] Confirm a `FixPrRun` row is created and status changes from `QUEUED` to `RUNNING`
- [ ] Confirm inbox polling updates without page refresh

#### Manual scenario B: read-only specialist stage

- [ ] Run with Sentry configured and confirm RCA output includes issue IDs, stack frames, and likely files
- [ ] Run without Sentry configured and confirm degraded mode is recorded but the run continues
- [ ] Confirm code-context output narrows files/symbols instead of returning broad repo scope
- [ ] Confirm test-agent output shows ordered commands/checks

#### Manual scenario C: fix iteration

- [ ] Trigger a case where the fixer can make a small local patch
- [ ] Confirm changed files are recorded on `FixPrIteration`
- [ ] Confirm reviewer output is persisted after the fix step
- [ ] Confirm checks output is persisted after command execution

#### Manual scenario D: iterate on failure

- [ ] Use a case where reviewer returns a blocker and confirm the parent thread starts a second iteration
- [ ] Use a case where a test command fails and confirm failure artifacts are fed back into the next fix iteration
- [ ] Confirm `iterationCount` increments and prior iteration history remains visible

#### Manual scenario E: pass and handoff

- [ ] Confirm a clean run ends in `PASSED`
- [ ] Confirm a run exceeding `maxIterations` ends in `WAITING_REVIEW`
- [ ] Confirm triage history shows the final run status and any PR link if GitHub is enabled

#### Manual scenario F: cancellation and failure handling

- [ ] Trigger `cancelFixPR` while the workflow is between stages and confirm the run stops cleanly
- [ ] Force an app-server failure and confirm the run records a recoverable error
- [ ] Force a malformed fixer output and confirm the iteration is marked failed with human handoff

#### Manual scenario G: regression checks

- [x] Run `npm test`
- [x] Run `npm run type-check`
- [x] Run `npm run lint`
- [x] Run `npm run build --workspace @app/web`
- [x] Run `npm run build --workspace @app/codex`
