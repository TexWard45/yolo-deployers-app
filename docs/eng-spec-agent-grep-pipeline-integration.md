# Engineering Spec: Agent-Grep Pipeline Integration + Evidence Fixes

**Date:** 2026-03-21
**Branch:** `anh/codebase-reader`
**Status:** Draft

---

## 1. Job to Be Done

Three problems degrade the quality of the AI analysis and triage pipeline:

1. **Naive codebase search** — `searchCodebaseActivity` (analyze-thread) and `triageSearchCodebaseActivity` (triage-thread) concatenate raw message text into a single query string and hit `/api/rest/codex/search`. The `agent-grep` feature already exists and uses an LLM to decompose a task into semantic queries, keywords, and symbol names, then fans out parallel searches with deduplication. Switching to agent-grep will produce significantly better code search results.

2. **Sentry evidence dropped** — `SentryFinding` returns `{ issueId, title, culprit, count, firstSeen, lastSeen, level, stackTrace }`, but the LLM prompts only use a subset:
   - `thread-analysis.prompt.ts:97` casts to `{ title?, count?, lastSeen? }` — loses `culprit`, `level`, `firstSeen`.
   - `triage-spec.prompt.ts:148` casts to `{ title?, count?, stackTrace? }` — loses `culprit`, `level`.
   - The `culprit` field (file/function that caused the error) is high-signal context that never reaches the LLM.

3. **`threadSummary` always null** — `getThreadAnalysisContext` reads `thread.summary` from `SupportThread`, but `saveAnalysis` in `agent.ts:345-363` writes `summary` to `ThreadAnalysis`, never back-filling `SupportThread.summary`. On re-analysis, the sufficiency check and analysis prompt never see a conversation summary.

Additionally, because the search approach is changing, the spec includes an **A/B evaluation plan** to measure search quality before vs after.

---

## 2. Proposed Flow / Architecture

### 2a. Agent-Grep Integration

**Current flow (analyze-thread, Activity 3):**
```
messages[-3].body + issueFingerprint → concatenated string → POST /api/rest/codex/search
```

**Proposed flow:**
```
messages[-3].body + issueFingerprint + existing analysis summary
  → build taskDescription string
  → POST /api/rest/codex/agent/grep  (one call per repositoryId)
  → returns { summary, context, chunks[], timing }
```

Key differences:
- agent-grep calls `llmSummarizeTask` (GPT-4.1, 15s timeout) to extract structured queries from the task description.
- It runs parallel searches: N semantic queries + 1 keyword query + M symbol queries.
- Results are deduplicated by chunk ID, scored, and sorted.
- Each repository gets a separate agent-grep call (current behavior sends all repositoryIds in one call; agent-grep accepts a single `repositoryId`).

**Integration points:**

| Point | File | Current endpoint | New endpoint |
|-------|------|-----------------|--------------|
| A | `apps/queue/src/activities/analyze-thread.activity.ts:143` | `POST /api/rest/codex/search` | `POST /api/rest/codex/agent/grep` |
| B | `apps/queue/src/activities/triage-thread.activity.ts:126` | `POST /api/rest/codex/search` | `POST /api/rest/codex/agent/grep` |

For Point A, the `taskDescription` will be constructed from the last 3 message bodies + issueFingerprint (same data, but sent as natural language for the LLM to decompose). For Point B, the `analysisQuery` (which is already an analysis summary string) becomes the `taskDescription` directly.

Since `AgentGrepInput` takes a single `repositoryId`, the activity must loop over `codexRepositoryIds` and merge results. Use `Promise.all` for parallelism, then flatten + deduplicate chunks across repos.

### 2b. Sentry Evidence Fix

Expand the type casts in both prompt files to include all useful fields from `SentryFinding`:

**thread-analysis.prompt.ts** — change the Sentry section to render:
```
1. TypeError: Cannot read property 'foo' of undefined (42 occurrences, level: error, last seen: 2026-03-20)
   Culprit: src/handlers/foo.ts → handleRequest
```

**triage-spec.prompt.ts** — change the Sentry section to render:
```
- TypeError: Cannot read property 'foo' of undefined (42x, level: error)
  Culprit: src/handlers/foo.ts → handleRequest
  Stack: at handleRequest (src/handlers/foo.ts:42:12)...
```

### 2c. Thread Summary Back-fill

In `saveAnalysis` (`packages/rest/src/routers/agent.ts:378-388`), the `supportThread.update` call already updates `lastAnalysisId`. Add `summary: input.analysis.summary` (and `summaryUpdatedAt: new Date()`) to that same update so subsequent re-analyses see the prior summary.

The `SupportThread` schema already has `summary String?` and `summaryUpdatedAt DateTime?` fields — no migration needed.

### 2d. A/B Evaluation Architecture

To compare search quality, add a **shadow mode** flag on `WorkspaceAgentConfig` (or use an env var `CODEX_SEARCH_AB_MODE=true`). When enabled:

1. Both the old search (direct `/codex/search`) and new search (`/codex/agent/grep`) run in parallel.
2. Both result sets are stored in `ThreadAnalysis.codexFindings` as `{ v1: oldResults, v2: newResults }` (only during evaluation; production uses v2 only).
3. The LLM analysis receives only the **new** results (v2) for its actual output.
4. A post-hoc evaluation script compares v1 vs v2 by checking which chunks the LLM cited in its RCA.

---

## 3. Task Checklist

### Layer 1: Activity Layer (apps/queue)

- [ ] **Rewrite `searchCodebaseActivity`** in `apps/queue/src/activities/analyze-thread.activity.ts`
  - Build `taskDescription` from last 3 message bodies + issueFingerprint (natural language paragraph, not raw concat)
  - Loop over `codexRepositoryIds`, call `POST /api/rest/codex/agent/grep` for each with `{ workspaceId, repositoryId, taskDescription, maxResults: 5 }`
  - Merge chunks across repos, deduplicate by chunk ID, keep top 5 by score
  - Return the merged `AgentGrepResult` shape (preserve `summary` and `timing` from first repo call)
  - Add error handling: if agent-grep fails, fall back to existing `/codex/search` behavior (log warning)
  - Update activity params: add `issueFingerprint` as explicit param (already available on `AnalysisContext`)

- [ ] **Rewrite `triageSearchCodebaseActivity`** in `apps/queue/src/activities/triage-thread.activity.ts`
  - Change param from `analysisQuery: string` to `taskDescription: string` (semantic rename)
  - Loop over `codexRepositoryIds`, call `POST /api/rest/codex/agent/grep` for each
  - Same merge/dedup logic as above
  - Same fallback behavior on error

- [ ] **Update workflow callers** — verify `analyze-thread.workflow.ts` and `triage-thread.workflow.ts` pass correct params to the rewritten activities. The workflow files call the activity functions directly (Temporal), so param shape changes must match.

### Layer 2: Prompt Layer (packages/rest)

- [ ] **Fix Sentry evidence in `thread-analysis.prompt.ts`**
  - `packages/rest/src/routers/helpers/thread-analysis.prompt.ts:96-102`
  - Change cast from `Array<{ title?, count?, lastSeen? }>` to `Array<{ title?, culprit?, count?, firstSeen?, lastSeen?, level?, stackTrace? }>`
  - Update the render format to include `culprit` and `level`:
    ```
    ${i+1}. ${e.title} (${e.count} occurrences, level: ${e.level}, last seen: ${e.lastSeen})
       Culprit: ${e.culprit}
    ```
  - Add `stackTrace` when available (truncated to 200 chars)

- [ ] **Fix Sentry evidence in `triage-spec.prompt.ts`**
  - `packages/rest/src/routers/helpers/triage-spec.prompt.ts:144-159`
  - Change cast from `Array<{ title?, count?, stackTrace? }>` to `Array<{ title?, culprit?, count?, firstSeen?, lastSeen?, level?, stackTrace? }>`
  - Update the render format to include `culprit` and `level`:
    ```
    - ${e.title} (${e.count}x, level: ${e.level})
      Culprit: ${e.culprit}
      Stack: ${e.stackTrace}
    ```

### Layer 3: Persistence Layer (packages/rest)

- [ ] **Back-fill `SupportThread.summary`** in `saveAnalysis`
  - `packages/rest/src/routers/agent.ts:378-388`
  - Add `summary: input.analysis.summary` and `summaryUpdatedAt: new Date()` to the `supportThread.update` data object
  - This ensures `getThreadAnalysisContext` (which reads `thread.summary`) gets a non-null value on subsequent analyses

### Layer 4: REST Endpoint (apps/web) — Already Done

- [x] `POST /api/rest/codex/agent/grep` already exists at `apps/web/src/app/api/rest/codex/agent/grep/route.ts`
- [x] tRPC procedure `codex.agent.grepRelevantCode` already exists in `packages/rest/src/routers/codex/router.ts:337-342`

---

## 4. Testing Checklist

### Unit / Integration Tests

- [ ] **searchCodebaseActivity** — mock `fetch` to `/api/rest/codex/agent/grep`, verify:
  - Correct `taskDescription` construction from messages + fingerprint
  - Parallel calls for multiple repositoryIds
  - Deduplication across repos (same chunk ID from two repos keeps highest score)
  - Fallback to `/codex/search` when agent-grep returns non-200
  - Graceful handling when `codexRepositoryIds` is empty (returns null)

- [ ] **triageSearchCodebaseActivity** — same assertions as above, verify `analysisQuery` maps to `taskDescription`

- [ ] **Sentry evidence rendering** — snapshot test `buildUserMessage()` in both prompt files with a full `SentryFinding[]` input, verify `culprit`, `level`, `firstSeen` appear in the output string

- [ ] **Summary back-fill** — integration test `saveAnalysis` procedure, verify `SupportThread.summary` is updated after save

### Manual Smoke Tests

- [ ] Trigger analysis on a thread with Codex repos configured — verify agent-grep is called (check queue worker logs for `[agent-grep-prompt]` entries)
- [ ] Trigger triage on a thread — verify agent-grep is called for the re-search step
- [ ] Trigger analysis on a thread with Sentry configured — verify `culprit` and `level` appear in the analysis output
- [ ] Re-analyze a thread — verify `threadSummary` is non-null on the second analysis run (check sufficiency check input logs)

### A/B Evaluation Plan

#### Setup

1. **Identify evaluation set**: Select 20-50 threads that have already been analyzed with the old search (v1). These threads should have `ThreadAnalysis.codexFindings IS NOT NULL` so we know codex search ran.

   ```sql
   SELECT ta.id AS analysis_id, ta."threadId", ta.summary, ta."rcaSummary",
          ta."codexFindings", ta."createdAt"
   FROM "ThreadAnalysis" ta
   WHERE ta."codexFindings" IS NOT NULL
     AND ta."workspaceId" = '<workspace_id>'
   ORDER BY ta."createdAt" DESC
   LIMIT 50;
   ```

2. **Extract v1 search inputs**: For each thread, reconstruct the original search query (last 3 message bodies + fingerprint):

   ```sql
   SELECT st.id AS thread_id, st."issueFingerprint",
          (SELECT string_agg(tm.body, ' ' ORDER BY tm."createdAt" DESC)
           FROM (SELECT body, "createdAt" FROM "ThreadMessage"
                 WHERE "threadId" = st.id ORDER BY "createdAt" DESC LIMIT 3) tm
          ) AS recent_messages
   FROM "SupportThread" st
   WHERE st.id IN (<thread_ids_from_step_1>);
   ```

3. **Run shadow evaluation**: For each thread, call both endpoints with the same input:
   - `POST /api/rest/codex/search` with the concatenated query (v1 baseline)
   - `POST /api/rest/codex/agent/grep` with the same text as `taskDescription` (v2 candidate)

   Script: `scripts/ab-eval-codex-search.ts` (see structure below)

#### Metrics

| Metric | Definition | How to measure |
|--------|-----------|----------------|
| **Chunk precision** | % of returned chunks that the LLM actually cites in its RCA | Re-run analysis LLM with v1 chunks and v2 chunks separately, parse `rcaSummary` for file path mentions, compare cited vs returned |
| **Chunk recall** | Whether the correct file (if known) appears in results | For threads where a human identified the root cause file, check if it appears in v1 vs v2 results |
| **RCA quality** | Human rating of RCA quality (1-5 scale) | Side-by-side blind comparison of v1-RCA vs v2-RCA for 20 threads |
| **Latency (p50/p95)** | End-to-end search time | Compare `timing.totalMs` from agent-grep vs elapsed time of old search call |
| **LLM cost** | Additional tokens from summarize step | Track `summarizeMs` and estimate token count from agent-grep prompt |

#### Evaluation Script Structure

```typescript
// scripts/ab-eval-codex-search.ts
// Usage: npx tsx scripts/ab-eval-codex-search.ts --workspace <id> --limit 30

interface EvalRow {
  threadId: string;
  taskDescription: string;
  v1Chunks: Array<{ id: string; filePath: string; score: number }>;
  v2Chunks: Array<{ id: string; filePath: string; score: number }>;
  v1LatencyMs: number;
  v2LatencyMs: number;
  overlapCount: number;    // chunks appearing in both
  v2OnlyCount: number;     // chunks unique to v2
  v1OnlyCount: number;     // chunks unique to v1
}

// Steps:
// 1. Fetch threads with existing analyses from DB
// 2. For each thread, build taskDescription from messages
// 3. Call both endpoints, record results + timing
// 4. Compute overlap and unique chunks
// 5. Output CSV: threadId, v1_count, v2_count, overlap, v1_latency, v2_latency
```

#### Success Criteria

- v2 returns at least 1 chunk that v1 missed in >= 60% of threads
- v2 p95 latency stays under 5 seconds (agent-grep LLM summarize adds ~1-2s)
- No regression: v2 should not lose chunks that v1 found in > 20% of cases
- RCA quality rating (blind human eval) improves by >= 0.5 points on average

#### Rollout Plan

1. **Phase 1 (shadow)**: Deploy with env var `CODEX_SEARCH_AB_MODE=true`. Both search methods run; v2 results used for analysis, v1 results logged for comparison. Duration: 1 week.
2. **Phase 2 (full)**: Remove shadow mode, delete v1 code paths, agent-grep becomes the only search method.
3. **Rollback**: If v2 latency exceeds 8s p95 or RCA quality drops, revert to v1 by setting `CODEX_SEARCH_AB_MODE=false` (falls back to old `/codex/search` endpoint).

---

## Appendix: File Reference

| File | Role |
|------|------|
| `apps/queue/src/activities/analyze-thread.activity.ts` | Activity 3: codebase search (rewrite target) |
| `apps/queue/src/activities/triage-thread.activity.ts` | Activity 2: triage re-search (rewrite target) |
| `packages/rest/src/routers/helpers/thread-analysis.prompt.ts` | Analysis LLM prompt (Sentry evidence fix) |
| `packages/rest/src/routers/helpers/triage-spec.prompt.ts` | Triage LLM prompt (Sentry evidence fix) |
| `packages/rest/src/routers/agent.ts` | `saveAnalysis` mutation (summary back-fill fix) |
| `packages/rest/src/routers/codex/agent-grep.ts` | Agent-grep implementation (already exists) |
| `packages/rest/src/routers/codex/agent-grep.prompt.ts` | Agent-grep LLM prompt (already exists) |
| `packages/rest/src/routers/codex/router.ts` | tRPC procedure for agent-grep (already exists) |
| `apps/web/src/app/api/rest/codex/agent/grep/route.ts` | REST endpoint for agent-grep (already exists) |
| `packages/rest/src/routers/helpers/sentry-client.ts` | `SentryFinding` interface (reference) |
| `packages/database/prisma/thread.schema.prisma` | `SupportThread` model with `summary` field |
| `packages/database/prisma/support.schema.prisma` | `ThreadAnalysis` model |
