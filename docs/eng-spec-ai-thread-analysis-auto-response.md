# Engineering Spec: AI Thread Analysis & Auto-Response Pipeline

## 1. Job to Be Done

**Who:** Support teams using the inbox to handle customer issues (Discord, in-app, API channels).

**What:** After messages accumulate in a `SupportThread`, the AI agent automatically:
1. Evaluates whether the thread has enough context to understand the issue (sufficiency check)
2. If sufficient: generates a structured **summary**, runs **RCA** against the connected codebase (Codex hybrid search) and **Sentry error logs**, then produces a **draft reply**
3. If insufficient: auto-generates a **clarifying question** to the customer asking for the missing information

**Why:** Today, `generateDraft()` in `agent.ts` is a placeholder. Support agents must manually read every thread, search the codebase, check Sentry, and write replies. This is slow and doesn't scale. The AI should do the heavy lifting — triage, investigate, draft — so humans only review and approve.

**Success criteria:**
- Every inbound message in an AI-enabled workspace triggers the analysis pipeline (via Temporal workflow)
- Threads get a structured `analysisSummary` with issue classification, affected component, severity, and RCA findings
- Codex search results are included when the thread references code, errors, or technical behavior
- Sentry error events are fetched and correlated when stack traces, error messages, or Sentry issue IDs are detected
- When context is insufficient, a `ReplyDraft` with `type: CLARIFICATION` is auto-generated asking targeted questions
- When context is sufficient, a `ReplyDraft` with `type: RESOLUTION` is auto-generated with the proposed fix/answer
- Human approves or dismisses every draft before it reaches the customer (existing `approveDraft`/`dismissDraft` flow)
- The pipeline completes within 30s for typical threads (< 20 messages)

---

## 2. Proposed Flow / Architecture

### 2.1 High-Level Flow

```
Inbound message arrives (performIngestion)
  │
  ├── existing: thread matching, message creation, thread review dispatch
  │
  └── NEW: dispatch analyzeThreadWorkflow (if workspace agent enabled + autoDraftOnInbound)
        │
        ├── 1. Debounce (30s quiet period — batch rapid messages)
        │
        ├── 2. Fetch thread context (messages, customer, agent config)
        │
        ├── 3. Sufficiency check (LLM call)
        │     ├── SUFFICIENT → continue to step 4
        │     └── INSUFFICIENT → generate clarification draft → done
        │
        ├── 4. Parallel investigation
        │     ├── 4a. Codex search (if technical issue detected)
        │     └── 4b. Sentry lookup (if error signals detected)
        │
        ├── 5. Generate analysis summary (LLM call with all context)
        │     └── Write ThreadAnalysis record
        │
        └── 6. Generate resolution draft (LLM call)
              └── Write ReplyDraft with type RESOLUTION
```

### 2.2 Data Model Changes

#### New Model: `ThreadAnalysis`

Stores the AI-generated analysis for a thread. One per analysis run (a thread can have multiple over its lifetime as new messages arrive).

```prisma
model ThreadAnalysis {
  id              String   @id @default(cuid())
  threadId        String
  thread          SupportThread @relation(fields: [threadId], references: [id])
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id])

  // Classification
  issueCategory   String?      // e.g. "bug", "feature_request", "how_to", "account", "outage"
  severity        String?      // "critical", "high", "medium", "low"
  affectedComponent String?    // extracted from messages or Codex match
  summary         String       // structured summary of the issue

  // Investigation results
  codexFindings   Json?        // top Codex search results (chunks, file paths, symbols)
  sentryFindings  Json?        // Sentry error events, stack traces, occurrence count
  rcaSummary      String?      // root cause analysis narrative

  // Sufficiency
  sufficient      Boolean      // whether context was deemed sufficient
  missingContext  String[]     // what's missing if insufficient

  // Metadata
  model           String?      // LLM model used
  promptVersion   String?      // prompt version for tracking
  totalTokens     Int?         // token usage
  durationMs      Int?         // pipeline duration

  createdAt       DateTime @default(now())

  @@index([threadId, createdAt])
  @@index([workspaceId, createdAt])
}
```

#### Modify `ReplyDraft`: add `draftType` field

```prisma
enum DraftType {
  RESOLUTION      // AI has enough context, proposes a fix/answer
  CLARIFICATION   // AI needs more info, asks targeted questions
  MANUAL          // Human-written draft
}

// Add to ReplyDraft model:
draftType  DraftType @default(RESOLUTION)
analysisId String?   // FK to ThreadAnalysis that produced this draft
analysis   ThreadAnalysis? @relation(fields: [analysisId], references: [id])
```

#### Modify `WorkspaceAgentConfig`: add Sentry + analysis settings

```prisma
// Add fields to existing WorkspaceAgentConfig:
sentryDsn             String?   // Sentry DSN for API access
sentryOrgSlug         String?   // Sentry org slug
sentryProjectSlug     String?   // Sentry project slug
sentryAuthToken       String?   // Sentry API auth token (encrypted at rest)
codexRepositoryIds    String[]  // Which Codex repos to search for RCA
analysisEnabled       Boolean   @default(true)  // master switch for analysis pipeline
maxClarifications     Int       @default(2)      // max auto-clarifications before escalating
```

#### Modify `SupportThread`: add analysis tracking

```prisma
// Add fields to existing SupportThread:
clarificationCount    Int       @default(0)      // how many times AI asked for clarification
lastAnalysisId        String?   // FK to most recent ThreadAnalysis
lastAnalysis          ThreadAnalysis? @relation("latestAnalysis", fields: [lastAnalysisId], references: [id])
```

### 2.3 Temporal Workflow: `analyzeThreadWorkflow`

**File:** `apps/queue/src/workflows/analyze-thread.workflow.ts`

```
Input: { workspaceId, threadId, source, triggeredByMessageId }
Output: { analysisId, draftId, action: "clarification" | "resolution" | "escalated" | "skipped" }
```

**Activities:**

| Activity | Purpose | Timeout |
|----------|---------|---------|
| `getThreadAnalysisContext` | Fetch thread messages, customer, agent config, prior analyses | 10s |
| `checkSufficiency` | LLM call: is context enough to diagnose? | 15s |
| `searchCodebase` | Codex hybrid search for related code | 15s |
| `fetchSentryErrors` | Sentry API: search for matching errors | 10s |
| `generateAnalysis` | LLM call: produce structured analysis + RCA | 25s |
| `generateDraftReply` | LLM call: produce resolution or clarification draft | 15s |
| `saveAnalysisAndDraft` | Write ThreadAnalysis + ReplyDraft to DB via REST | 10s |

**Workflow logic:**

```
1. Sleep 30s (debounce — let rapid messages settle)
2. context = getThreadAnalysisContext(input)
   - If agent disabled or analysisEnabled=false → return "skipped"
   - If thread is CLOSED → return "skipped"
3. sufficiency = checkSufficiency(context)
   - If insufficient AND clarificationCount >= maxClarifications → escalate thread, return "escalated"
   - If insufficient → generateDraftReply(type=CLARIFICATION, missingContext) → return "clarification"
4. [parallel]
   - codexResults = searchCodebase(context) // skip if no codexRepositoryIds configured
   - sentryResults = fetchSentryErrors(context) // skip if no Sentry configured
5. analysis = generateAnalysis(context, codexResults, sentryResults)
6. draft = generateDraftReply(type=RESOLUTION, analysis)
7. saveAnalysisAndDraft(analysis, draft)
8. return { analysisId, draftId, action: "resolution" }
```

### 2.4 LLM Prompts

All prompts follow existing `*.prompt.ts` convention.

#### `sufficiency-check.prompt.ts`

**Input:** Thread messages, customer info, issue fingerprint
**Output:** `{ sufficient: boolean, missingContext: string[], confidence: number, reasoning: string }`

**System prompt guidance:**
- Evaluate if messages describe: what happened, when, where (page/feature), steps to reproduce, expected vs actual behavior
- For bugs: need at least 2 of {error message, reproduction steps, affected feature, environment}
- For feature requests: need at least {what they want, why they want it}
- For how-to questions: usually sufficient if the question is clear
- Consider the entire thread, not just the latest message

#### `thread-analysis.prompt.ts`

**Input:** Thread messages + Codex search results + Sentry errors + customer context
**Output:** `{ issueCategory, severity, affectedComponent, summary, rcaSummary, confidence }`

**System prompt guidance:**
- Synthesize all data sources: messages describe symptoms, Codex reveals the code, Sentry shows the error
- RCA should connect the customer's complaint → code path → error chain
- Severity: critical (data loss, security, total outage), high (broken feature, many users), medium (degraded experience), low (cosmetic, edge case)
- If Codex finds relevant code, cite file paths and function names
- If Sentry finds matching errors, cite error type, occurrence count, and first/last seen

#### `draft-reply.prompt.ts`

**Input:** Thread analysis + agent config (tone, systemPrompt) + draft type (RESOLUTION vs CLARIFICATION)
**Output:** `{ body: string, confidence: number }`

**System prompt guidance:**
- CLARIFICATION: ask specific, targeted questions about what's missing (from `missingContext`). Don't ask more than 3 questions. Be conversational, not robotic.
- RESOLUTION: provide the answer/fix. Reference specific findings. If RCA found a code issue, describe the root cause in user-friendly terms. If suggesting a workaround, be clear it's temporary.
- Always respect `tone` from agent config. Inject `systemPrompt` if provided.
- Never fabricate information not found in the investigation.

### 2.5 Sentry Integration

**New file:** `packages/rest/src/routers/helpers/sentry-client.ts`

Wraps the [Sentry Web API](https://docs.sentry.io/api/) to:
1. **Search issues** by keywords extracted from thread messages (`GET /api/0/projects/{org}/{project}/issues/`)
2. **Get latest event** for a matched issue (`GET /api/0/issues/{issue_id}/events/latest/`)
3. **Extract**: error type, message, stack trace, tags, occurrence count, first/last seen, affected users count

**Input signals for Sentry search:**
- Error messages quoted in thread messages (regex extraction)
- Stack trace fragments
- Sentry issue URLs pasted by users (extract issue ID directly)
- HTTP status codes + endpoint paths
- Keywords from `issueFingerprint`

**Output:** Serializable JSON stored in `ThreadAnalysis.sentryFindings`

### 2.6 Codex Integration

Reuse existing `hybridSearch()` from `packages/rest/src/routers/codex/search.ts`.

**Activity calls Codex search via REST endpoint** (queue can't import `@shared/rest` search internals):
```
POST {WEB_APP_URL}/api/rest/codex/search
Body: { workspaceId, query, repositoryIds, limit: 5, channels: { semantic: true, keyword: true, symbol: true } }
```

**Query construction:**
- Extract technical terms from thread: error messages, function names, file paths, feature names
- Use `issueFingerprint` + last 3 message bodies as search corpus
- If Sentry error has a stack trace, search for the top frame's function/file

### 2.7 Dispatch from Ingestion

In `performIngestion()` (packages/rest/src/routers/intake.ts), after message creation and thread review dispatch:

```typescript
// After existing thread review dispatch...
if (agentConfig?.enabled && agentConfig?.analysisEnabled && agentConfig?.autoDraftOnInbound) {
  await dispatchAnalyzeThreadWorkflow({
    workspaceId: input.workspaceId,
    threadId: matchedThread.id,
    source: input.source,
    triggeredByMessageId: newMessage.id,
  });
}
```

**Workflow ID:** `analyze-thread-{threadId}` — one per thread, idempotent. If already running (from a previous message), the new dispatch is skipped; the running workflow's debounce will pick up the new message.

### 2.8 REST Endpoints for Analysis

New endpoints for the frontend to consume:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rest/thread/[id]/analysis` | GET | Get latest ThreadAnalysis for a thread |
| `/api/rest/thread/[id]/analysis/trigger` | POST | Manually trigger analysis pipeline |

These map to new tRPC procedures in the `thread` or `agent` router.

### 2.9 Frontend Changes

#### Thread Detail Page (`/inbox/[threadId]`)

Add an **Analysis Panel** (collapsible sidebar or tab):
- **Summary card**: issue category badge, severity badge, affected component
- **RCA section**: narrative with linked code files (clickable → Codex chunk viewer)
- **Sentry section**: error card with occurrence count, stack trace preview, link to Sentry
- **Draft section**: shows pending draft with approve/dismiss buttons (existing UI, extend with draft type badge)
- **Status indicator**: "Analyzing...", "Analysis complete", "Needs clarification"
- **Re-analyze button**: manually trigger fresh analysis

#### Agent Config Page (`/settings/agent`)

Add fields for:
- Sentry connection settings (DSN, org, project, auth token) with test-connection button
- Codex repository selection (multi-select from workspace repos)
- Analysis toggle, max clarifications slider

### 2.10 Dependencies

| Dependency | Purpose | Where |
|------------|---------|-------|
| Sentry Web API | Error event retrieval | `@shared/rest` (helpers) |
| OpenAI SDK | LLM calls (already installed) | `@shared/rest` (prompts) |
| Codex hybrid search | Codebase RCA (already built) | Via REST endpoint |
| Temporal SDK | Workflow orchestration (already installed) | `apps/queue` |

**New env vars** (add to `@shared/env`):
- None globally required — Sentry credentials are per-workspace in `WorkspaceAgentConfig`

---

## 3. Task Checklist

### Schema / Data

- [ ] Add `ThreadAnalysis` model to `schema.prisma` — stores AI analysis results per thread
- [ ] Add `DraftType` enum and `draftType` + `analysisId` fields to `ReplyDraft` model
- [ ] Add Sentry config fields to `WorkspaceAgentConfig` — `sentryDsn`, `sentryOrgSlug`, `sentryProjectSlug`, `sentryAuthToken`, `codexRepositoryIds`, `analysisEnabled`, `maxClarifications`
- [ ] Add `clarificationCount` and `lastAnalysisId` fields to `SupportThread` model
- [ ] Run `db:generate` + `db:migrate` to apply schema changes
- [ ] Add Zod schemas in `packages/types/src/schemas/` — `ThreadAnalysisSchema`, `AnalyzeThreadWorkflowInputSchema`, `AnalyzeThreadWorkflowResultSchema`, `SufficiencyCheckResultSchema`, update `UpdateWorkspaceAgentConfigSchema`

### Backend / API — Sentry Client

- [ ] Create `packages/rest/src/routers/helpers/sentry-client.ts` — Sentry API wrapper (search issues, get latest event, extract error context)
- [ ] Add error signal extraction util — regex patterns for error messages, stack traces, Sentry URLs, HTTP codes from thread message bodies

### Backend / API — LLM Prompts

- [ ] Create `packages/rest/src/routers/helpers/sufficiency-check.prompt.ts` — LLM prompt to evaluate thread context sufficiency
- [ ] Create `packages/rest/src/routers/helpers/thread-analysis.prompt.ts` — LLM prompt to generate structured analysis + RCA from messages + Codex + Sentry
- [ ] Create `packages/rest/src/routers/helpers/draft-reply.prompt.ts` — LLM prompt to generate resolution or clarification draft reply

### Backend / API — tRPC Procedures

- [ ] Add `agent.getLatestAnalysis(threadId)` procedure — fetch most recent `ThreadAnalysis` for a thread
- [ ] Add `agent.triggerAnalysis(threadId, workspaceId)` procedure — manually dispatch `analyzeThreadWorkflow`
- [ ] Update `agent.updateWorkspaceConfig` to accept new Sentry + analysis fields
- [ ] Update `agent.generateDraft` to wire through the analysis pipeline instead of placeholder

### Backend / API — REST Endpoints

- [ ] Add `GET /api/rest/thread/[id]/analysis` route — maps to `agent.getLatestAnalysis`
- [ ] Add `POST /api/rest/thread/[id]/analysis/trigger` route — maps to `agent.triggerAnalysis`
- [ ] Add `POST /api/rest/analysis/save` route — called by queue activity to persist `ThreadAnalysis` + `ReplyDraft`

### Queue — Workflow & Activities

- [ ] Create `apps/queue/src/workflows/analyze-thread.workflow.ts` — orchestrates debounce → sufficiency → investigation → analysis → draft pipeline
- [ ] Create `apps/queue/src/activities/analyze-thread.activity.ts` — implements `getThreadAnalysisContext`, `checkSufficiency`, `searchCodebase`, `fetchSentryErrors`, `generateAnalysis`, `generateDraftReply`, `saveAnalysisAndDraft`
- [ ] Register workflow in `workflows/index.ts` and `workflows/registry.ts`
- [ ] Register activities in `activities/index.ts`
- [ ] Add `dispatchAnalyzeThreadWorkflow()` function to `packages/rest/src/temporal.ts`

### Wiring — Ingestion Integration

- [ ] Update `performIngestion()` in `packages/rest/src/routers/intake.ts` to dispatch `analyzeThreadWorkflow` after message creation (when agent enabled + analysis enabled + autoDraftOnInbound)

### Frontend / UI

- [ ] Create `AnalysisPanel` component — displays ThreadAnalysis summary, severity, RCA, Codex findings, Sentry findings
- [ ] Create `SentryErrorCard` component — displays Sentry error details (type, message, stack trace preview, occurrence count)
- [ ] Create `CodexFindingsCard` component — displays matched code chunks with file paths and snippets
- [ ] Add Analysis Panel to thread detail page (`/inbox/[threadId]`) — collapsible sidebar or tab
- [ ] Add draft type badge to existing draft display (RESOLUTION vs CLARIFICATION)
- [ ] Add "Re-analyze" button to thread detail page
- [ ] Add Sentry connection config fields to agent settings page
- [ ] Add Codex repository selector to agent settings page
- [ ] Add analysis toggle + max clarifications to agent settings page

### Cleanup

- [ ] Export new types from `@shared/types` — `ThreadAnalysis`, `DraftType`, analysis input/output types
- [ ] Update CLAUDE.md with analysis pipeline architecture section

---

## 4. Testing Checklist

### Happy Path

- [ ] Inbound message in AI-enabled workspace triggers `analyzeThreadWorkflow` — verify Temporal workflow starts
- [ ] Sufficient thread (clear bug report with error message) produces `ThreadAnalysis` with `sufficient: true`, populated `summary`, `issueCategory`, `severity`
- [ ] Codex search returns relevant code chunks when thread mentions a feature/error — verify `codexFindings` populated
- [ ] Sentry lookup returns matching errors when thread contains error messages — verify `sentryFindings` populated
- [ ] Resolution draft is generated with appropriate tone from agent config
- [ ] Insufficient thread (vague "it's broken") produces clarification draft asking specific questions
- [ ] Approve/dismiss flow works for both RESOLUTION and CLARIFICATION drafts
- [ ] Manual "Re-analyze" button triggers fresh analysis and produces new `ThreadAnalysis` record

### Validation

- [ ] `analyzeThreadWorkflow` is not dispatched when `agentConfig.enabled = false`
- [ ] `analyzeThreadWorkflow` is not dispatched when `agentConfig.analysisEnabled = false`
- [ ] `analyzeThreadWorkflow` is not dispatched when `agentConfig.autoDraftOnInbound = false`
- [ ] Sentry lookup is skipped when no Sentry credentials configured — `sentryFindings` is null, pipeline continues
- [ ] Codex search is skipped when no `codexRepositoryIds` configured — `codexFindings` is null, pipeline continues
- [ ] Invalid Sentry credentials produce graceful error (logged, pipeline continues without Sentry data)

### Edge Cases

- [ ] Rapid messages (3 messages in 5s) debounce correctly — only one analysis runs with all messages included
- [ ] Thread with 50+ messages — verify prompt truncation/windowing keeps within token limits
- [ ] Thread with only system messages (no inbound) — analysis skipped
- [ ] Clarification count reaches `maxClarifications` — thread escalated to `ESCALATED` status, no more auto-drafts
- [ ] Concurrent analysis dispatch (same thread) — second dispatch skipped (idempotent workflow ID)
- [ ] Codex search returns zero results — analysis still completes, `codexFindings` empty
- [ ] Sentry returns zero matching issues — analysis still completes, `sentryFindings` empty
- [ ] LLM timeout (>25s) — activity retries up to 3 times, then pipeline fails gracefully
- [ ] Thread is CLOSED between dispatch and execution — workflow returns "skipped"

### Auth / Permissions

- [ ] `agent.triggerAnalysis` requires workspace membership
- [ ] `agent.getLatestAnalysis` requires workspace membership
- [ ] Sentry auth token is not exposed in API responses (redacted in `getWorkspaceConfig`)
- [ ] `saveAnalysisAndDraft` REST endpoint validates workspace ownership

### UI

- [ ] Analysis Panel renders loading state while workflow is running
- [ ] Analysis Panel renders empty state when no analysis exists
- [ ] Severity badge shows correct color (critical=red, high=orange, medium=yellow, low=blue)
- [ ] Codex findings show clickable file paths
- [ ] Sentry error card shows stack trace in collapsible section
- [ ] Draft type badge distinguishes RESOLUTION from CLARIFICATION
- [ ] Agent settings page: Sentry test-connection button shows success/failure
- [ ] Agent settings page: Codex repo selector shows all workspace repos

### Type Safety & Build

- [ ] `npm run type-check` passes with all new types and schema changes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds for `@app/web`, `@app/queue`
- [ ] `npm run db:generate` regenerates types correctly after schema changes
