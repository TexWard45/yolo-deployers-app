# Engineering Spec: Triage Pipeline — Linear Ticket Creation & PR Kickoff

## 1. Job to Be Done

- **Who**: Internal support engineers / workspace admins viewing thread analysis results.
- **What**: After the AI analysis pipeline gathers enough context (chat messages → Codex search → Sentry errors), display a rich internal-only investigation view in the thread. Provide a **Triage** button that creates (or updates) a Linear ticket from the analysis, and then enables generating a `/spec` → PR from that ticket.
- **Why**: Today the pipeline stops at "here's a draft reply." Engineers must manually copy analysis findings into Linear, write specs, and create PRs. This closes the loop: analysis → triage → ticket → spec → PR — all from the thread view.
- **Success criteria**:
  - Internal investigation panel shows chat context summary, Codex findings, and Sentry errors with visual grouping (not visible to end customers).
  - "Triage to Linear" button creates a Linear issue with pre-filled title, description (from analysis), severity label, and linked code references.
  - If a Linear issue already exists for the thread, the button updates the existing issue instead of creating a duplicate.
  - After ticket creation, a "Create PR" action generates an eng spec and opens a draft PR (or copies spec to clipboard for manual PR).
  - Linear API token + team config is per-workspace (stored on `WorkspaceAgentConfig`).

---

## 2. Proposed Flow / Architecture

### 2.1 Data Model Changes

**New fields on `WorkspaceAgentConfig`:**

```prisma
// Linear integration
linearApiKey        String?   // encrypted Linear API key
linearTeamId        String?   // default team for new issues
linearDefaultLabels String[]  // label names to auto-apply (e.g. ["bug", "support-escalation"])
```

**New fields on `SupportThread`:**

```prisma
linearIssueId       String?   @unique  // Linear issue ID (e.g. "PROJ-123")
linearIssueUrl      String?             // full URL for linking
```

**New model `TriageAction`** (audit log of triage decisions):

```prisma
model TriageAction {
  id              String        @id @default(cuid())
  threadId        String
  thread          SupportThread @relation(fields: [threadId], references: [id])
  workspaceId     String
  workspace       Workspace     @relation(fields: [workspaceId], references: [id])
  analysisId      String
  analysis        ThreadAnalysis @relation(fields: [analysisId], references: [id])
  action          String        // "CREATE_TICKET" | "UPDATE_TICKET" | "CREATE_PR"
  linearIssueId   String?
  linearIssueUrl  String?
  prUrl           String?
  metadata        Json?
  createdById     String
  createdBy       User          @relation(fields: [createdById], references: [id])
  createdAt       DateTime      @default(now())

  @@index([threadId])
  @@index([workspaceId, createdAt])
}
```

### 2.2 API Layer

**New tRPC procedures in `packages/rest/src/routers/agent.ts`:**

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| `agent.triageToLinear` | mutation | `{ threadId, workspaceId, userId, analysisId, overrides?: { title?, description?, severity?, labels? } }` | Creates or updates Linear issue from analysis. Returns `{ linearIssueId, linearIssueUrl, action: "created" \| "updated" }` |
| `agent.getTriageStatus` | query | `{ threadId, workspaceId }` | Returns current Linear issue info + triage history for thread |
| `agent.generateSpec` | mutation | `{ threadId, workspaceId, userId, linearIssueId }` | Generates eng spec markdown from analysis + codex findings. Returns `{ specMarkdown, specTitle }` |

**New Zod schemas in `packages/types/src/schemas/`:**

```ts
export const TriageToLinearSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  analysisId: z.string(),
  overrides: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    severity: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    labels: z.array(z.string()).optional(),
  }).optional(),
});

export const GetTriageStatusSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
});

export const GenerateSpecSchema = z.object({
  threadId: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  linearIssueId: z.string().optional(),
});
```

**Sentry client upgrade** (`packages/rest/src/routers/helpers/sentry-client.ts`):

Replace the stub `fetchSentryContext()` with real Sentry Web API calls:
1. Extract error signals from thread messages (already implemented in `extractErrorSignals()`)
2. Query `GET /api/0/projects/{org}/{project}/issues/?query={signal}&sort=date&limit=5`
3. For top matches, get latest event: `GET /api/0/issues/{issueId}/events/latest/`
4. Return `SentryFinding[]` with stacktrace, count, timestamps
5. Respect a 10s timeout with `AbortController`

**New prompt file** (`packages/rest/src/routers/helpers/triage-spec.prompt.ts`):

LLM prompt that takes `ThreadAnalysis` + `codexFindings` + `sentryFindings` + thread messages and generates:
- Linear issue title (concise)
- Linear issue description (structured: summary, repro steps, affected component, severity rationale, code references, Sentry links)
- Eng spec markdown (job-to-be-done, proposed fix, task checklist, testing checklist)

### 2.3 Linear API Integration

**New helper** (`packages/rest/src/routers/helpers/linear-client.ts`):

```ts
import { LinearClient } from "@linear/sdk";

export function createLinearClient(apiKey: string): LinearClient;

export async function createLinearIssue(client: LinearClient, input: {
  teamId: string;
  title: string;
  description: string;      // markdown
  priority: number;          // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  labelNames?: string[];
}): Promise<{ id: string; identifier: string; url: string }>;

export async function updateLinearIssue(client: LinearClient, issueId: string, input: {
  title?: string;
  description?: string;
  priority?: number;
  state?: string;            // for status transitions
}): Promise<{ id: string; identifier: string; url: string }>;

export async function getLinearIssue(client: LinearClient, issueId: string): Promise<LinearIssue | null>;
```

**Package**: `@linear/sdk` — add to `packages/rest/package.json`.

### 2.4 Frontend

**Enhanced `AnalysisPanel.tsx`** — add triage section below existing analysis display:

```
┌─────────────────────────────────┐
│  AI Analysis (existing)         │
│  ├─ Severity: HIGH              │
│  ├─ Category: bug               │
│  ├─ Component: auth middleware   │
│  ├─ Summary: ...                │
│  ├─ RCA: ...                    │
│  ├─ Codex Findings (3)          │
│  │   └─ file.ts:42 — funcName  │
│  └─ Sentry Findings (2)  ← NEW │
│      ├─ TypeError: ... (142x)   │
│      └─ stacktrace preview      │
├─────────────────────────────────┤
│  Triage Actions          ← NEW │
│  ┌───────────────────────────┐  │
│  │ [Triage to Linear]       │  │ ← creates/updates ticket
│  │ (or "Update PROJ-123" if │  │
│  │  ticket already exists)  │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ [Generate Spec → PR]     │  │ ← after ticket exists
│  └───────────────────────────┘  │
│  Triage History:                │
│  • Created PROJ-123 — 2h ago   │
│  • Updated PROJ-123 — 1h ago   │
└─────────────────────────────────┘
```

**New component `TriageSection.tsx`** (client component):

- Shows "Triage to Linear" or "Update {linearIssueId}" based on thread state
- Pre-fills title/description from analysis; allows override via inline edit
- After ticket creation: shows link to Linear issue + "Generate Spec" button
- "Generate Spec" calls `agent.generateSpec`, displays markdown preview, offers "Copy to Clipboard" and "Create PR" actions

**New component `SentryFindings.tsx`** (client component):

- Renders Sentry error cards: title, culprit, count, first/last seen, collapsible stacktrace
- Linked to Sentry UI via issue URL

**Visibility**: The entire AnalysisPanel (including triage section) is already internal-only — it renders in the right sidebar of `ThreadDetailSheet` and is not exposed to customers. No additional visibility gating needed.

### 2.5 Flow Diagram

Everything above the `═══` line is **already built**. Everything below is **new in this spec**.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INBOUND MESSAGE                              │
│                   (Discord / In-App Chat)                           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   performIngestion()   │
              │  upsert customer       │
              │  match/create thread   │
              │  create message        │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  AI enabled + auto?    │──── No ───▶ (stop, manual only)
              └────────────┬───────────┘
                          Yes
                           │
                           ▼
         ┌─────────────────────────────────┐
         │   analyzeThreadWorkflow         │
         │   (Temporal, debounce 60s)      │
         └─────────────────┬───────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Fetch context         │
              │  • last 20 messages    │
              │  • customer metadata   │
              │  • agent config        │
              └────────────┬───────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Sufficiency check     │
              │  (GPT-4.1)             │
              └─────┬──────────┬───────┘
                    │          │
              Sufficient    Insufficient
                    │          │
                    │          ▼
                    │   ┌──────────────────┐
                    │   │ clarifications   │
                    │   │ < max (2)?       │
                    │   └───┬─────────┬────┘
                    │      Yes        No
                    │       │          │
                    │       ▼          ▼
                    │   CLARIFICATION  ESCALATED
                    │   draft → save   (stop)
                    │
                    ▼
    ┌───────────────────────────────────────┐
    │        PARALLEL INVESTIGATION         │
    │                                       │
    │  ┌─────────────┐  ┌────────────────┐  │
    │  │ Codex Search │  │ Sentry Lookup  │  │
    │  │ (semantic +  │  │ (real API) NEW │  │
    │  │  keyword +   │  │ • issue search │  │
    │  │  symbol)     │  │ • stacktraces  │  │
    │  │  top 5 chunks│  │ • error counts │  │
    │  └──────┬───────┘  └───────┬────────┘  │
    │         │                  │            │
    └─────────┼──────────────────┼────────────┘
              │                  │
              ▼                  ▼
    ┌─────────────────────────────────────┐
    │  Generate Analysis (GPT-4.1)       │
    │  • issueCategory, severity         │
    │  • affectedComponent               │
    │  • summary + rcaSummary            │
    │  • connect symptoms → code paths   │
    │  • connect symptoms → Sentry errs  │
    └──────────────────┬──────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────┐
    │  Generate Draft Reply (GPT-4.1)    │
    │  RESOLUTION type                   │
    └──────────────────┬──────────────────┘
                       │
                       ▼
    ┌─────────────────────────────────────┐
    │  Save via REST                     │
    │  POST /api/rest/analysis/save      │
    │  → ThreadAnalysis + ReplyDraft     │
    └──────────────────┬──────────────────┘
                       │
                       │
═══════════════════════╪══════════════════════════════════════
  PIPELINE DONE        │        HUMAN IN THE LOOP BELOW
═══════════════════════╪══════════════════════════════════════
                       │
                       ▼
    ┌─────────────────────────────────────────────────────┐
    │              ANALYSIS PANEL (internal only)         │
    │                                                     │
    │  ┌─ Severity: HIGH ─ Category: bug ──────────────┐  │
    │  │  Summary: Auth middleware drops session...     │  │
    │  │  RCA: Token refresh race in /auth/callback     │  │
    │  ├───────────────────────────────────────────────┤  │
    │  │  Codex:  auth-middleware.ts:142 — refreshTkn  │  │
    │  │          session-store.ts:89  — getSession    │  │
    │  ├───────────────────────────────────────────────┤  │
    │  │  Sentry: TypeError: null is not obj (142x)    │  │  ◀── NEW
    │  │          ▸ stacktrace (collapsible)            │  │
    │  ├───────────────────────────────────────────────┤  │
    │  │  Draft: "Hi, we identified a race condition   │  │
    │  │   in the auth flow..."  [Send] [Edit] [Drop]  │  │
    │  └───────────────────────────────────────────────┘  │
    └──────────────────────┬──────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────────┐
    │                                                     │
    │         ┌──────────────────────────┐                │
    │         │  ★ TRIAGE TO LINEAR ★    │    ◀── NEW     │
    │         └────────────┬─────────────┘                │
    │                      │                              │
    │              ┌───────┴────────┐                     │
    │              │                │                     │
    │        No ticket yet    Thread has                  │
    │              │          linearIssueId               │
    │              ▼                ▼                     │
    │     ┌──────────────┐  ┌──────────────┐             │
    │     │ CREATE issue │  │ UPDATE issue │             │
    │     │ Linear SDK   │  │ Linear SDK   │             │
    │     │ • title      │  │ • append new │             │
    │     │ • desc (LLM) │  │   findings   │             │
    │     │ • severity   │  │ • update     │             │
    │     │ • labels     │  │   severity   │             │
    │     │ • code refs  │  │              │             │
    │     └──────┬───────┘  └──────┬───────┘             │
    │            │                 │                      │
    │            └────────┬────────┘                      │
    │                     │                               │
    │                     ▼                               │
    │     ┌──────────────────────────────┐                │
    │     │  Save to thread:             │                │
    │     │  • linearIssueId = PROJ-123  │                │
    │     │  • linearIssueUrl            │                │
    │     │  • TriageAction audit log    │                │
    │     └──────────────┬───────────────┘                │
    │                    │                                │
    │                    ▼                                │
    │     ┌──────────────────────────────┐                │
    │     │  ✓ PROJ-123 linked          │                │
    │     │  [Open in Linear ↗]         │                │
    │     └──────────────┬───────────────┘                │
    │                    │                                │
    │                    ▼                                │
    │     ┌──────────────────────────────┐                │
    │     │  ★ GENERATE SPEC ★          │    ◀── NEW     │
    │     └──────────────┬───────────────┘                │
    │                    │                                │
    │                    ▼                                │
    │     ┌──────────────────────────────┐                │
    │     │  LLM generates eng spec:     │                │
    │     │  • job-to-be-done            │                │
    │     │  • proposed fix (from RCA    │                │
    │     │    + codex + sentry)         │                │
    │     │  • task checklist            │                │
    │     │  • testing checklist         │                │
    │     └──────────────┬───────────────┘                │
    │                    │                                │
    │                    ▼                                │
    │     ┌──────────────────────────────┐                │
    │     │  Spec Preview (markdown)     │                │
    │     │  [Copy] [Create PR ↗]       │                │
    │     └──────────────────────────────┘                │
    │                                                     │
    └─────────────────────────────────────────────────────┘
```

**The wow moment in one sentence:**

> Customer reports bug → AI reads chat + code + Sentry → shows root cause with code paths and error counts → one click creates a Linear ticket → one click generates a spec ready for a PR.

**Three NEW pieces vs what exists today:**
1. **Sentry goes real** — actual error counts + stacktraces instead of empty `[]`
2. **Triage to Linear** — one-click ticket with LLM-structured body
3. **Generate Spec** — eng spec from analysis → clipboard/PR

### 2.6 Master Workflow: `supportPipelineWorkflow`

Single Temporal workflow that orchestrates the entire pipeline end-to-end. Each step is a pluggable activity — swap implementations independently.

```
supportPipelineWorkflow(input)
│
├─ Debounce 60s
│
├─ GATE 1: evalGate1ShouldInvestigate        ✅ PLUGGED IN
│   checks: agent enabled, analysis enabled,
│           thread open, has inbound messages
│
├─ PHASE 1: Context                          ✅ PLUGGED IN
│   ├─ getThreadAnalysisContext
│   ├─ checkSufficiencyActivity
│   └─ if insufficient → clarify or escalate
│
├─ PHASE 2: Investigate (parallel)           ✅ PLUGGED IN
│   ├─ searchCodebaseActivity (Codex)
│   ├─ fetchSentryErrorsActivity (Sentry)
│   └─ // TODO: fetchSessionReplayActivity
│
├─ PHASE 3: Analyze + Draft                  ✅ PLUGGED IN
│   ├─ generateAnalysisActivity (LLM)
│   ├─ generateDraftReplyActivity (LLM)
│   └─ saveAnalysisAndDraftActivity
│
├─ GATE 2: evalGate2ShouldTriage             ✅ PLUGGED IN (basic)
│   checks: Linear configured
│   // TODO: severity threshold, confidence
│   // TODO: threshold, autoTriage flag
│
├─ PHASE 4: Triage                           ✅ PLUGGED IN
│   ├─ generateLinearIssueActivity (LLM)
│   ├─ createOrUpdateLinearTicketActivity
│   └─ saveTriageResultActivity
│
├─ GATE 3: evalGate3ShouldSpec               ✅ PLUGGED IN (basic)
│   checks: category is actionable
│           (not how_to/account)
│   // TODO: autoSpec flag, codex quality
│   // TODO: check
│
└─ PHASE 5: Spec                             ✅ PLUGGED IN
    ├─ generateEngSpecActivity (LLM)
    ├─ saveTriageResultActivity
    └─ // TODO: auto-create PR via GitHub API
```

**Key files:**
- `apps/queue/src/workflows/support-pipeline.workflow.ts` — master orchestrator
- `apps/queue/src/activities/pipeline-eval.activity.ts` — 3 eval gates
- `packages/rest/src/temporal.ts` — `dispatchSupportPipelineWorkflow()`

### 2.7 Dependencies

| Dependency | Where | Purpose |
|------------|-------|---------|
| `@linear/sdk` | `packages/rest/package.json` | Linear API client |
| `SENTRY_AUTH_TOKEN` (per workspace) | Already on `WorkspaceAgentConfig` | Real Sentry API calls |
| `LINEAR_API_KEY` (per workspace) | New field on `WorkspaceAgentConfig` | Linear API auth |

No new env vars at the global level — all integration credentials are per-workspace on `WorkspaceAgentConfig`.

---

## 3. Task Checklist

### Schema / Data

- [ ] Add `linearApiKey`, `linearTeamId`, `linearDefaultLabels` fields to `WorkspaceAgentConfig` in schema.prisma
- [ ] Add `linearIssueId`, `linearIssueUrl` fields to `SupportThread` in schema.prisma
- [ ] Create `TriageAction` model in schema.prisma with indexes
- [ ] Add relation from `ThreadAnalysis` to `TriageAction[]`
- [ ] Run `db:generate` + `db:migrate` to apply schema changes
- [ ] Add `TriageToLinearSchema`, `GetTriageStatusSchema`, `GenerateSpecSchema` Zod schemas in `packages/types/src/schemas/`
- [ ] Export new schemas from `packages/types/src/schemas/index.ts`

### Backend / API

- [ ] Implement real `fetchSentryContext()` in `packages/rest/src/routers/helpers/sentry-client.ts` — replace stub with Sentry Web API calls (issues search + latest event)
- [ ] Create `packages/rest/src/routers/helpers/linear-client.ts` — Linear SDK wrapper (create, update, get issue)
- [ ] Create `packages/rest/src/routers/helpers/triage-spec.prompt.ts` — LLM prompt for generating Linear issue body + eng spec from analysis
- [ ] Add `agent.triageToLinear` tRPC mutation — create/update Linear issue, save to thread, create TriageAction audit log
- [ ] Add `agent.getTriageStatus` tRPC query — return Linear issue info + triage history for thread
- [ ] Add `agent.generateSpec` tRPC mutation — generate eng spec markdown from analysis + codex + sentry findings
- [ ] Update `agent.updateWorkspaceConfig` to handle new Linear fields (linearApiKey, linearTeamId, linearDefaultLabels)
- [ ] Add `@linear/sdk` to `packages/rest/package.json`

### Frontend / UI

- [ ] Create `SentryFindings.tsx` component — render Sentry error cards (title, culprit, count, stacktrace collapsible)
- [ ] Create `TriageSection.tsx` component — "Triage to Linear" / "Update {PROJ-123}" button, inline title/description override, triage history
- [ ] Create `SpecPreview.tsx` component — markdown preview of generated spec with "Copy" and "Create PR" actions
- [ ] Integrate `SentryFindings` into `AnalysisPanel.tsx` — render below Codex findings when sentryFindings is non-empty
- [ ] Integrate `TriageSection` into `AnalysisPanel.tsx` — render below investigation findings when analysis exists
- [ ] Add server actions in `apps/web/src/actions/inbox.ts` — `triageToLinearAction()`, `getTriageStatusAction()`, `generateSpecAction()`
- [ ] Add Linear config fields to workspace agent config settings UI (linearApiKey, linearTeamId, linearDefaultLabels)

### Wiring

- [ ] Update `fetchSentryErrorsActivity` in `apps/queue/src/activities/analyze-thread.activity.ts` to pass real Sentry config (already reads from context; just needs `fetchSentryContext` to be implemented)
- [ ] Ensure `saveAnalysis` mutation passes `sentryFindings` JSON through to `ThreadAnalysis` record (verify existing JSON field works with real data)
- [ ] Update `AnalysisPanel` polling to also refresh triage status after analysis loads
- [ ] Wire "Create PR" button — for MVP, copy spec to clipboard + open GitHub new-PR URL in new tab

### Cleanup

- [ ] Update `UpdateWorkspaceAgentConfigSchema` in Zod schemas to include Linear fields
- [ ] Run `npm run type-check` across all packages
- [ ] Run `npm run build` for web + queue to verify no breakage
- [ ] Update CLAUDE.md with Linear integration details in the AI Analysis Pipeline section

---

## 4. Testing Checklist

### Happy Path

- [ ] Configure workspace with Linear API key + team ID → config saves and persists
- [ ] Configure workspace with Sentry credentials → Sentry errors appear in analysis panel after pipeline runs
- [ ] Click "Triage to Linear" on a thread with analysis → Linear issue created with correct title, description, severity, labels
- [ ] Thread now shows "Update PROJ-123" instead of "Triage to Linear" → clicking updates existing issue
- [ ] Click "Generate Spec" after ticket exists → spec markdown appears with summary, RCA, code references, task checklist
- [ ] Copy spec to clipboard → valid markdown
- [ ] Full flow: inbound message → analysis → triage → Linear ticket → spec → ready for PR

### Validation

- [ ] `triageToLinear` without `linearApiKey` configured → clear error: "Linear not configured for this workspace"
- [ ] `triageToLinear` with invalid Linear API key → error: "Linear authentication failed"
- [ ] `triageToLinear` with missing `analysisId` → Zod validation error
- [ ] `generateSpec` without existing analysis → error: "No analysis found"
- [ ] Sentry fetch with invalid credentials → graceful fallback (empty findings, no crash)
- [ ] Sentry fetch timeout (>10s) → returns empty array, pipeline continues

### Edge Cases

- [ ] Thread already has `linearIssueId` → update flow, not create
- [ ] Linear issue was deleted externally → handle 404, allow re-creation
- [ ] Multiple rapid "Triage" clicks → idempotent (same issue, no duplicates)
- [ ] Analysis re-run after triage → new analysis does not clear `linearIssueId`; "Update" button uses latest analysis
- [ ] Thread with no Codex repos configured → spec generates without code references (graceful)
- [ ] Thread with no Sentry config → Sentry section hidden, triage still works
- [ ] Very long analysis summary (>10k chars) → Linear description truncated with "... see full analysis in [thread link]"

### Auth / Permissions

- [ ] Only OWNER/ADMIN can configure Linear API key (matches existing `updateWorkspaceConfig` check)
- [ ] Only workspace members can triage (workspace membership check)
- [ ] Linear API key is redacted in `getWorkspaceConfig` response (show "***" like Sentry token)
- [ ] `TriageAction` records `createdById` for audit trail

### UI

- [ ] Sentry findings render with collapsible stacktraces — default collapsed
- [ ] "Triage to Linear" button shows loading spinner during API call
- [ ] After triage: Linear issue link opens in new tab
- [ ] Spec preview renders markdown correctly (headers, code blocks, lists)
- [ ] Triage history shows chronological list of actions with timestamps
- [ ] Empty states: no Sentry findings → section hidden; no triage history → "No triage actions yet"
- [ ] Responsive: triage section works in narrow sidebar width

### Type Safety & Build

- [ ] `npm run type-check` passes across all packages
- [ ] `npm run build` succeeds for `@app/web`, `@app/queue`
- [ ] `npm run build --workspace @app/codex` still passes (no regression)
- [ ] New Zod schemas are importable from `@shared/types`
- [ ] `TriageAction` model types available via `@shared/types/prisma`
