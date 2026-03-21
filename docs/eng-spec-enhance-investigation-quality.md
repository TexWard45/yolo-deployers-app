# Engineering Spec: Enhance Investigation Quality (3 Phases + A/B Testing)

## 1. Job to Be Done

- **Who:** Support agents using the AI analysis pipeline to investigate customer issues
- **What:** Improve the quality of automated investigation by adding three capabilities: (1) real Sentry error data, (2) cross-encoder re-ranking for code search, (3) expanded code context around search results — each with independent A/B testing to measure impact
- **Why:** The analysis pipeline currently has blind spots: code search results aren't re-ranked for precision, and the LLM only sees isolated code chunks without surrounding context. Sentry integration exists but needed hardening. These gaps limit RCA quality, draft accuracy, and agent trust.
- **Success criteria:**
  - Phase 1: Sentry findings are populated in `ThreadAnalysis.sentryFindings` with real error data (title, culprit, stack trace) for workspaces with Sentry configured
  - Phase 2: Re-ranked search results produce higher-quality top-5 chunks (measured by LLM citation rate in `rcaSummary`)
  - Phase 3: Expanded context leads to more specific RCA with file/function citations
  - A/B: Each phase has measurable before/after metrics via shadow-mode comparison stored in `AnalysisABLog`

---

## 2. Proposed Flow / Architecture

### Phase 1: Real Sentry Integration — COMPLETED

#### Implementation Summary

The Sentry client code (`sentry-client.ts`) was already partially implemented. Phase 1 hardened it with rate-limit handling, multi-project support, connection testing, error signal extraction improvements, and A/B logging.

#### What Was Built

1. **Rate limit handling** — `searchSentryIssuesForProject()` retries once on 429 with `Retry-After` header (capped at 5s delay)
2. **Multi-project support** — `SentryConfig.projectSlugs?: string[]` iterates multiple Sentry projects per workspace, falls back to single `projectSlug`
3. **Connection testing** — `testSentryConnection()` validates credentials against `GET /api/0/projects/{org}/{project}/`, returns `{ ok, projectName?, error? }`
4. **Error signal extraction fix** — `extractErrorSignals()` now extracts both short error type names (`TypeError`, `DatabaseError`) and capped error messages (40 chars max) for better Sentry search matching
5. **A/B logging** — `fetchSentryErrorsActivity` logs control (empty) vs variant (real findings) + latency to `AnalysisABLog` when `investigationABEnabled` is true
6. **A/B results query** — `agent.getABResults` tRPC query with aggregation (totalRuns, avgLatencyMs, findingsRate) + `GET /api/rest/agent/ab-results` REST endpoint
7. **Settings UI** — Sentry Integration section with org slug, project slug, auth token inputs + Test Connection button + connection status badge
8. **Linear settings UI** — added Linear API Key + Team ID inputs to the same settings form

#### Data Model Changes (Applied)

```prisma
// support.schema.prisma — WorkspaceAgentConfig (new fields)
sentryProjectSlugs     String[]        // multi-project support
investigationABEnabled Boolean @default(false)  // A/B master toggle

// NEW model
model AnalysisABLog {
  id              String   @id @default(cuid())
  threadId        String
  analysisId      String
  workspaceId     String
  phase           String   // "sentry" | "rerank" | "context_expansion" | "combined"
  controlResult   Json?
  variantResult   Json?
  latencyMs       Int?
  tokenDelta      Int?
  chunkOverlap    Float?
  createdAt       DateTime @default(now())
  @@index([workspaceId, phase, createdAt])
  @@index([threadId])
}
```

#### Files Changed

| File | Change |
|------|--------|
| `packages/database/prisma/support.schema.prisma` | Added `sentryProjectSlugs`, `investigationABEnabled`, `AnalysisABLog` model |
| `packages/types/src/schemas/index.ts` | Added `sentryProjectSlugs`, `investigationABEnabled` to update schema, added `TestSentryConnectionSchema` |
| `packages/rest/src/routers/helpers/sentry-client.ts` | 429 retry, multi-project search, `testSentryConnection()`, improved `extractErrorSignals()` |
| `packages/rest/src/routers/agent.ts` | Added `testSentryConnection`, `getABResults` procedures, updated default config |
| `packages/rest/src/index.ts` | Exported `testSentryConnection` |
| `apps/queue/src/activities/analyze-thread.activity.ts` | Multi-project sentryConfig, `investigationABEnabled` on context, A/B logging in `fetchSentryErrorsActivity` |
| `apps/queue/src/activities/triage-thread.activity.ts` | Multi-project sentryConfig construction |
| `apps/queue/src/workflows/analyze-thread.workflow.ts` | Pass A/B params to `fetchSentryErrorsActivity` |
| `apps/queue/src/workflows/support-pipeline.workflow.ts` | Same A/B params wiring |
| `apps/web/src/actions/agent-settings.ts` | Added `testSentryConnectionAction`, expanded `updateAgentConfigAction` with sentry + linear fields |
| `apps/web/src/app/workspace/[slug]/settings/page.tsx` | Pass sentry + linear config to form |
| `apps/web/src/app/workspace/[slug]/settings/settings-form.tsx` | Added Sentry Integration + Linear Integration UI sections |
| `apps/web/src/app/api/rest/agent/test-sentry/route.ts` | NEW — REST endpoint for connection testing |
| `apps/web/src/app/api/rest/agent/ab-results/route.ts` | NEW — REST endpoint for A/B results query |
| `apps/web/src/app/api/rest/intake/ingest/route.ts` | NEW — REST endpoint for external message ingestion (testing) |

#### Verified A/B Test Results

Tested with Flowboard demo app connected to Sentry (org: `texward45`, project: `node-express`):

```json
{
  "summary": [{
    "phase": "sentry",
    "totalRuns": 1,
    "avgLatencyMs": 3966,
    "runsWithFindings": 1,
    "findingsRate": 100
  }],
  "variantResult": [
    { "title": "TypeError: Cannot read properties of null (reading 'permissions')", "count": 1, "culprit": "GET /test/auth-crash", "stackTrace": "..." },
    { "title": "Error: TaskService: Failed to serialize task payload", "count": 3, "culprit": "GET /test/error", "stackTrace": "..." },
    { "title": "Error: DatabaseError: Connection pool exhausted", "count": 1, "culprit": "GET /test/timeout", "stackTrace": "..." },
    { "title": "AuthError: Invalid credentials", "count": 1, "culprit": "POST /api/v1/users/login", "stackTrace": "..." }
  ]
}
```

#### Lessons Learned During Implementation

1. **`extractErrorSignals()` regex was too greedy** — original regex captured up to 80 chars, producing search queries too long for Sentry's search API. Fixed by splitting into two patterns: short error type names (`TypeError`) and capped messages (40 chars).
2. **`@sentry/nextjs` SDK is incompatible with turbopack** — `withSentryConfig()` and top-level `await import()` in `instrumentation.ts` cause empty responses or startup crashes. Disabled SDK for dev; only enable in production with webpack. The per-workspace Sentry API client works independently.
3. **`localhost` DNS resolution issues on Windows** — curl to `localhost:3000` returns empty; `169.254.248.224:3000` works. Use the network IP from Next.js startup output.
4. **Queue worker must restart to pick up activity changes** — `tsx` doesn't hot-reload Temporal activities. Restart `npm run dev` after modifying activities.
5. **Prisma `db execute` doesn't show SELECT output** — use the app's API endpoints or direct `psql` for debugging DB state.

#### Known Limitations

- `@sentry/nextjs` SDK is installed but disabled (all config files are no-ops). Re-enable when deploying to production with webpack.
- `analysisId` in `AnalysisABLog` is set to `"pending"` — not updated after analysis is saved. Phase 2 should wire this up.
- No frontend for viewing A/B results — query via `GET /api/rest/agent/ab-results`.

---

### Phase 2: Cross-Encoder Re-Ranking

#### Current State
- `reranker.ts` is a stub that returns candidates unchanged
- `search.ts` already calls `rerank()` when `input.rerank` is true (line 394-399)
- `codexEnv` has `CODEX_RERANKER_ENABLED` and `CODEX_RERANKER_MODEL` env vars
- `CodexSearchSchema` has a `rerank` field in input

#### What's Needed

1. **Implement `rerank()` in `reranker.ts`** — call Cohere Rerank API
2. **Add `COHERE_API_KEY` to codex env** — required for Cohere API
3. **Enable rerank in agent-grep** — pass `rerank: true` when called from analysis pipeline
4. **A/B logging** — run both paths, compare chunk rankings

#### Data Model Changes

No schema changes needed — `AnalysisABLog` (from Phase 1) handles Phase 2 logging with `phase: "rerank"`.

#### API Layer

No new procedures — the existing `hybridSearch` already accepts `rerank` flag.

Update `reranker.ts`:
```typescript
import { CohereClientV2 } from "cohere-ai";

let _cohereClient: CohereClientV2 | undefined;

function getCohereClient(): CohereClientV2 {
  if (!_cohereClient) {
    _cohereClient = new CohereClientV2({
      token: process.env["COHERE_API_KEY"],
    });
  }
  return _cohereClient;
}

export async function rerank(
  query: string,
  candidates: FusedResult[],
): Promise<FusedResult[]> {
  const client = getCohereClient();

  const response = await client.rerank({
    model: process.env["CODEX_RERANKER_MODEL"] ?? "rerank-v3.5",
    query,
    documents: candidates.map((c) => ({
      text: `${c.filePath}\n${c.symbolName ?? ""}\n${c.content}`,
    })),
    topN: candidates.length,
  });

  return response.results
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map((r) => ({
      ...candidates[r.index]!,
      score: r.relevanceScore,
    }));
}
```

#### Flow

1. Agent-grep runs hybrid search with `rerank: false` (control) and `rerank: true` (variant) when A/B enabled
2. Only the variant (reranked) results are passed to the LLM
3. `AnalysisABLog` stores both result sets with `phase: "rerank"`, `chunkOverlap` metric
4. When A/B is disabled and `CODEX_RERANKER_ENABLED=true`, all searches use reranking

#### Dependencies
- **New package:** `cohere-ai` (npm) — Cohere SDK for rerank API
- **New env var:** `COHERE_API_KEY` in `packages/env/src/codex.ts`
- **Timeout:** 5s AbortController — if Cohere fails, fall back to RRF-only results

---

### Phase 3: Chunk Context Expansion

#### Current State
- `chunk.context` tRPC procedure exists in `router.ts` (line 262-297) — fetches surrounding chunks from the same file
- `CodexChunk` has `parentChunkId` field for parent-child relationships (e.g., method → class)
- `searchCodebaseActivity` returns top 5 chunks but no surrounding context

#### What's Needed

1. **Batch context endpoint** — new REST endpoint that accepts multiple chunk IDs and returns parent + siblings for each
2. **Context expansion activity** — new Temporal activity that calls the batch endpoint after agent-grep
3. **Prompt formatting** — update `thread-analysis.prompt.ts` to separate "Primary Evidence" and "Surrounding Context"
4. **Token budget** — cap supplementary context at 4000 chars per primary chunk

#### Data Model Changes

No schema changes — uses existing `CodexChunk.parentChunkId` relationships.

#### API Layer

New tRPC procedure in codex router:
```typescript
batchContext: publicProcedure
  .input(z.object({
    chunkIds: z.array(z.string()).max(10),
    maxSiblings: z.number().int().min(0).max(5).default(3),
  }))
  .query(async ({ ctx, input }) => {
    // For each chunk ID:
    //   1. Find the chunk's parentChunkId
    //   2. If parent exists, fetch parent + up to maxSiblings sibling chunks
    //   3. If no parent (top-level), return empty context
    // Return: Map<chunkId, { parent: Chunk | null, siblings: Chunk[] }>
  })
```

New REST endpoint: `POST /api/rest/codex/chunk/batch-context`

New activity in `analyze-thread.activity.ts`:
```typescript
export async function expandChunkContextActivity(params: {
  chunkIds: string[];
  maxSiblings?: number;
}): Promise<Record<string, { parent: unknown; siblings: unknown[] }> | null>
```

#### Flow

1. `searchCodebaseActivity` returns top 5 chunks (unchanged)
2. New `expandChunkContextActivity` calls `POST /api/rest/codex/chunk/batch-context` with the 5 chunk IDs
3. Returns parent class + up to 3 sibling methods per chunk
4. `generateAnalysisActivity` receives both primary chunks and expanded context
5. `thread-analysis.prompt.ts` formats as two sections:
   - **Primary Evidence:** the 5 matched chunks (as today)
   - **Surrounding Context:** parent signatures + sibling signatures (truncated, max 4000 chars per primary chunk)
6. A/B: when enabled, run LLM analysis twice — once with raw chunks, once with expanded context. Log to `AnalysisABLog` with `phase: "context_expansion"`, `tokenDelta` metric

#### Dependencies
- No new packages
- No new env vars

---

### A/B Testing Architecture (Shared Across All Phases) — COMPLETED

#### Design Principles
- **Shadow mode** — both control and variant run; only variant is user-facing
- **Per-phase toggles** — each phase can be A/B tested independently
- **Single log table** — `AnalysisABLog` with `phase` discriminator
- **Master toggle** — `WorkspaceAgentConfig.investigationABEnabled`
- **No user-facing changes** — A/B is invisible to support agents

#### Implemented Endpoints

- `agent.getABResults` tRPC query — aggregates per-phase metrics (totalRuns, avgLatencyMs, runsWithFindings, findingsRate)
- `GET /api/rest/agent/ab-results?workspaceId=X&userId=X&phase=sentry` — REST wrapper

#### Metrics Per Phase

| Phase | Control | Variant | Metrics |
|-------|---------|---------|---------|
| Sentry | `sentryFindings: []` | `sentryFindings: [real data]` | RCA cites errors? Draft approval rate. `latencyMs`. |
| Rerank | RRF-only top-5 | Reranked top-5 | `chunkOverlap` (% same chunks). LLM citation rate. `latencyMs`. |
| Context Expansion | Raw chunks | Chunks + parent/siblings | `tokenDelta`. RCA specificity (file/function count). `latencyMs`. |

#### Combined A/B (Post All Phases)

After all 3 phases ship, a `phase: "combined"` entry compares the full old pipeline (no sentry, no rerank, no expansion) vs the full new pipeline. Run on every Nth analysis (configurable, default N=2). Requires minimum 50 threads before drawing conclusions.

---

## 3. Task Checklist

### Phase 1: Real Sentry Integration — COMPLETED

#### Schema / Data
- [x] Add `sentryProjectSlugs String[]` to `WorkspaceAgentConfig` — multi-project support
- [x] Add `investigationABEnabled Boolean @default(false)` to `WorkspaceAgentConfig` — A/B master toggle
- [x] Create `AnalysisABLog` model — shared experiment log table for all phases
- [x] Add Zod schemas: `TestSentryConnectionInput` in `packages/types/src/schemas/`
- [x] Run `db:generate` + `db:push`

#### Backend / API
- [x] Add 429 retry with `Retry-After` in `sentry-client.ts` `searchSentryIssuesForProject()` — handle Sentry rate limits
- [x] Add multi-project search in `searchSentryIssues()` — iterate `config.projectSlugs` if populated, fall back to single `projectSlug`
- [x] Add `testSentryConnection` tRPC procedure in `agent.ts` — validates credentials against Sentry API
- [x] Add A/B logging to `fetchSentryErrorsActivity` — when `investigationABEnabled`, log control vs variant to `AnalysisABLog`
- [x] Add `POST /api/rest/agent/test-sentry` REST endpoint wrapping the tRPC procedure
- [x] Add `agent.getABResults` tRPC query — aggregate metrics per phase
- [x] Add `GET /api/rest/agent/ab-results` REST endpoint
- [x] Fix `extractErrorSignals()` — split into short error type names + capped messages for better Sentry search matching

#### Frontend / UI
- [x] Add Sentry Integration section to workspace settings — org slug, project slug, auth token inputs
- [x] Add "Test Connection" button — calls `testSentryConnectionAction`, shows green success or red error
- [x] Add connection status badge — "Connected" (green) or "Not configured" (gray)
- [x] Add Linear Integration section — API key + team ID inputs with same pattern

#### Wiring
- [x] Update `updateWorkspaceConfig` to accept `sentryProjectSlugs` and `investigationABEnabled`
- [x] Update `getWorkspaceConfig` default return with new fields
- [x] Wire A/B params through both `analyzeThreadWorkflow` and `supportPipelineWorkflow`
- [x] Export `testSentryConnection` from `@shared/rest`

### Phase 2: Cross-Encoder Re-Ranking

#### Schema / Data
- [ ] Add `COHERE_API_KEY` to `packages/env/src/codex.ts` — optional, required when `CODEX_RERANKER_ENABLED=true`

#### Backend / API
- [ ] Implement `rerank()` in `reranker.ts` — call Cohere Rerank API with 5s timeout, fallback to passthrough on error
- [ ] Install `cohere-ai` package in `packages/rest`
- [ ] Update `agent-grep.ts` to pass `rerank: true` when called from analysis pipeline — add optional `rerank` param to `grepRelevantCode()`
- [ ] Add A/B logging to `searchCodebaseActivity` — when enabled, run hybrid search twice (with/without rerank), log `chunkOverlap` to `AnalysisABLog`

#### Wiring
- [ ] Add `COHERE_API_KEY` to CI env secrets for `build-codex.yml`
- [ ] Rebuild codex and queue workers

### Phase 3: Chunk Context Expansion

#### Backend / API
- [ ] Add `batchContext` tRPC procedure to codex router — accepts chunk IDs, returns parent + siblings per chunk
- [ ] Add `POST /api/rest/codex/chunk/batch-context` REST endpoint
- [ ] Add `expandChunkContextActivity` in `analyze-thread.activity.ts` — calls batch-context endpoint, caps at 4000 chars per primary chunk
- [ ] Wire `expandChunkContextActivity` into `analyzeThreadWorkflow` — after `searchCodebaseActivity`, before `generateAnalysisActivity`
- [ ] Update `thread-analysis.prompt.ts` `buildUserMessage()` — add "Surrounding Context" section with parent signatures + sibling summaries
- [ ] Add A/B logging — when enabled, run `generateAnalysisActivity` twice (with/without expanded context), log `tokenDelta` to `AnalysisABLog`
- [ ] Add Zod schema `CodexBatchContextInput` in `packages/types/src/schemas/codex.ts`

#### Wiring
- [ ] Register `expandChunkContextActivity` in `apps/queue/src/activities/index.ts`
- [ ] Add activity proxy in `analyze-thread.workflow.ts` with 30s timeout
- [ ] Rebuild queue worker

---

## 4. Testing Checklist

### Phase 1: Sentry Integration

- [x] **Happy path** — workspace with valid Sentry credentials triggers analysis → `ThreadAnalysis.sentryFindings` is populated with real `SentryFinding[]` data
- [x] **Test connection** — `testSentryConnection` returns `{ ok: true, projectName: "..." }` for valid credentials and `{ ok: false, error: "..." }` for invalid
- [x] **No credentials** — workspace without Sentry config → `fetchSentryErrorsActivity` returns `[]`, workflow continues normally
- [x] **A/B logging** — when `investigationABEnabled=true`, `AnalysisABLog` entry created with `phase: "sentry"` and both control/variant data
- [x] **A/B results endpoint** — `GET /api/rest/agent/ab-results` returns summary + logs with correct aggregation
- [ ] **Rate limit handling** — mock 429 response → client retries after `Retry-After` delay, succeeds on second attempt
- [ ] **Timeout** — mock slow Sentry API → 10s timeout fires, returns `[]` without crashing workflow
- [ ] **No error signals** — messages with no error patterns → `extractErrorSignals()` returns `[]`, no API calls made
- [ ] **Multi-project** — workspace with `sentryProjectSlugs: ["proj-a", "proj-b"]` → searches both projects, deduplicates by issue ID

### Phase 2: Re-Ranking

- [ ] **Happy path** — search with `rerank: true` → results are reordered by Cohere relevance scores
- [ ] **Cohere timeout** — mock 5s timeout → falls back to RRF-only results, `timing.rerankMs` reflects attempt duration
- [ ] **Cohere error** — mock API error → falls back gracefully, no workflow failure
- [ ] **Score normalization** — reranked results have `score` from Cohere's `relevanceScore` (0-1 range)
- [ ] **Agent-grep integration** — `grepRelevantCode()` with `rerank: true` → reranked results returned
- [ ] **A/B logging** — when enabled, `AnalysisABLog` entry with `phase: "rerank"`, `chunkOverlap` calculated correctly
- [ ] **Disabled state** — `CODEX_RERANKER_ENABLED=false` → rerank is never called even if `rerank: true` in input

### Phase 3: Context Expansion

- [ ] **Happy path** — chunk with `parentChunkId` → `batchContext` returns parent + up to 3 siblings
- [ ] **No parent** — top-level function chunk → returns `{ parent: null, siblings: [] }`, no error
- [ ] **Token budget** — supplementary context exceeds 4000 chars → truncated to fit
- [ ] **Batch performance** — 5 chunk IDs → single DB query (not N+1)
- [ ] **Prompt formatting** — `buildUserMessage()` output has "Primary Evidence" and "Surrounding Context" sections
- [ ] **A/B logging** — when enabled, `AnalysisABLog` entry with `phase: "context_expansion"`, `tokenDelta` recorded
- [ ] **Empty expansion** — all 5 chunks are top-level → no expansion, analysis proceeds with raw chunks only

### Cross-Cutting

- [x] **Type safety** — `npm run type-check` passes across all packages
- [ ] **Lint** — `npm run lint` passes
- [x] **Build** — `npm run build --workspace @app/queue` succeeds
- [x] **Queue rebuild** — new/modified activities are exported from `activities/index.ts` and registered in workflow
- [x] **A/B results** — `getABResults` returns correct aggregates for each phase
- [ ] **Combined A/B** — when all 3 phases enabled + `investigationABEnabled=true`, every 2nd analysis runs full old vs new pipeline comparison
