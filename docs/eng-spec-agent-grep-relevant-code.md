# Engineering Spec: Agent Grep Relevant Code

## 1. Job to Be Done

- **Who**: Developers (and downstream automation agents) using the Codex codebase reader to locate relevant code before making changes.
- **What**: Given a free-text task description (e.g. "fix the login timeout bug"), automatically generate multiple targeted search queries and return the most relevant code chunks from an indexed repository.
- **Why**: The existing `codex.search` procedure requires the caller to know *what* to search for — a specific query string, symbol name, or keyword. For LLM-driven agent workflows and non-expert users, this is a barrier. The system should translate intent into search parameters automatically.
- **Success criteria**:
  1. A single API call with `{ taskDescription, repositoryId, workspaceId }` returns ranked code chunks without the caller crafting individual queries.
  2. Results are at least as relevant as manually running 3-5 hybrid searches, measured by whether the top 10 chunks contain the files a developer would actually edit for the described task.
  3. Response time is under 20 seconds end-to-end (LLM summarize + parallel searches).
  4. Graceful degradation: if the LLM times out, falls back to naive keyword extraction; if the repo has no embeddings, returns `ready: false` with an empty result.

## 2. Proposed Flow / Architecture

### Data Model Changes

**None.** This feature is a pure orchestration layer over existing `CodexRepository`, `CodexChunk`, and `CodexFile` models. No new Prisma models, fields, or migrations are needed.

### API Layer

New `codex.agent` tRPC sub-router mounted on the existing `codexRouter` in `packages/rest/src/routers/codex/router.ts`, with 3 procedures:

| Procedure | Type | Input | Output | Description |
|---|---|---|---|---|
| `agent.summarize` | mutation | `AgentGrepSummarizeInputSchema` | `AgentGrepSummarizeResult` | LLM call only — translates task description into search params |
| `agent.checkContext` | query | `AgentGrepContextCheckInputSchema` | `AgentGrepContextCheckResult` | Checks repo readiness (exists, chunk count, embedding coverage) |
| `agent.grepRelevantCode` | mutation | `AgentGrepInputSchema` | `AgentGrepResult` | Full orchestration: summarize + context check + parallel searches + dedup |

New REST endpoint:
- `POST /api/rest/codex/agent/grep` — thin wrapper around `trpc.codex.agent.grepRelevantCode`

### Zod Schemas (in `packages/types/src/schemas/codex.ts`)

```
AgentGrepSummarizeInputSchema    { taskDescription }
AgentGrepSummarizeResultSchema   { summary, semanticQueries[], keywords[], symbolNames[], languages?, chunkTypes? }
AgentGrepContextCheckInputSchema { workspaceId, repositoryId }
AgentGrepContextCheckResultSchema { ready, repositoryExists, displayName, totalChunks, embeddedChunks, embeddingCoverage, syncStatus }
AgentGrepInputSchema             { workspaceId, repositoryId, taskDescription, maxResults?, rerank? }
AgentGrepResultSchema            { summary, context, chunks[], totalFound, timing }
```

### New Files

| File | Purpose |
|---|---|
| `packages/rest/src/routers/codex/agent-grep.prompt.ts` | LLM prompt file (follows `*.prompt.ts` convention from `thread-match.prompt.ts`) |
| `packages/rest/src/routers/codex/agent-grep.ts` | Orchestration logic: `checkRepositoryContext()` + `grepRelevantCode()` |
| `apps/web/src/app/api/rest/codex/agent/grep/route.ts` | REST route handler |

### Modified Files

| File | Change |
|---|---|
| `packages/types/src/schemas/codex.ts` | Add 6 new Zod schemas + type exports |
| `packages/rest/src/routers/codex/router.ts` | Import new modules, create `agentRouter`, mount as `agent` on `codexRouter` |

No changes to `packages/types/src/schemas/index.ts` — it already has `export * from "./codex"`.

### Frontend

**Out of scope for this spec.** No new pages or components. The feature is API-only, consumed by:
1. External callers via `POST /api/rest/codex/agent/grep`
2. Downstream agent workflows (step 4 — PR creation, future spec)
3. Future UI (search page enhancement, future spec)

### Flow Diagram

```
1. Caller sends POST /api/rest/codex/agent/grep
   { workspaceId, repositoryId, taskDescription, maxResults? }

2. tRPC procedure calls grepRelevantCode()

3. Phase 1 — PARALLEL:
   a. llmSummarizeTask(taskDescription, openaiClient)
      → LLM (gpt-4.1, 15s timeout) returns:
        { summary, semanticQueries[], keywords[], symbolNames[], languages?, chunkTypes? }
      → On failure: fallback to naive { summary: taskDescription, keywords: split(taskDescription) }

   b. checkRepositoryContext(prisma, { workspaceId, repositoryId })
      → Queries CodexRepository + counts CodexChunk (total + embedded)
      → Returns { ready, repositoryExists, embeddingCoverage, ... }

4. If context.ready === false → return early with empty chunks

5. Phase 2 — PARALLEL searches (all reuse hybridSearch() from search.ts):
   a. For each semanticQueries[i]:
      → hybridSearch({ query: semanticQueries[i], channels: { semantic: true, keyword: false, symbol: false }, repositoryIds: [repositoryId] })

   b. For combined keywords:
      → hybridSearch({ query: keywords.join(" "), channels: { semantic: false, keyword: true, symbol: false }, repositoryIds: [repositoryId] })

   c. For each symbolNames[i]:
      → hybridSearch({ query: symbolNames[i], symbolName: symbolNames[i], channels: { semantic: false, keyword: false, symbol: true }, repositoryIds: [repositoryId] })

6. Deduplicate results by chunk ID (keep highest score, merge matchChannel)

7. Sort by score descending, take top maxResults

8. Return { summary, context, chunks, totalFound, timing }
```

### Dependencies

- **No new packages.** Reuses existing `openai` SDK (already in `@shared/rest`).
- **No new env vars.** Reuses `CODEX_EMBEDDING_API_KEY` via the existing lazy OpenAI singleton in `router.ts` (same API key works for both `embeddings.create` and `chat.completions.create`).
- **Key reuse points:**

| What | From | How |
|---|---|---|
| `hybridSearch()` | `search.ts` | Direct call with channel toggles per query type |
| `EmbedQueryFn` type | `search.ts` | Passed from router scope |
| OpenAI client | `router.ts` `getEmbedClient()` | Reuse same lazy singleton for chat completions |
| `SearchChunkRow`, `CodexSearchResult` | `search.ts` | Return types for chunks |
| LLM prompt pattern | `thread-match.prompt.ts` | System prompt + `buildUserMessage()` + exported async fn |
| REST endpoint pattern | `search/route.ts` | `createCaller` wrapper |

## 3. Task Checklist

### Schema / Data

- [ ] Add 6 Zod schemas to `packages/types/src/schemas/codex.ts` — `AgentGrepSummarizeInput`, `AgentGrepSummarizeResult`, `AgentGrepContextCheckInput`, `AgentGrepContextCheckResult`, `AgentGrepInput`, `AgentGrepResult` with inferred type exports

### Backend / API

- [ ] Create `packages/rest/src/routers/codex/agent-grep.prompt.ts` — system prompt for task-to-search-params translation, `llmSummarizeTask()` export, 15s AbortController timeout
- [ ] Create `packages/rest/src/routers/codex/agent-grep.ts` — `checkRepositoryContext()` (repo existence + chunk counts) and `grepRelevantCode()` (full orchestration with parallel searches + dedup)
- [ ] Wire `agentRouter` sub-router in `packages/rest/src/routers/codex/router.ts` — 3 procedures (`agent.summarize`, `agent.checkContext`, `agent.grepRelevantCode`), mount on `codexRouter`

### Wiring

- [ ] Create `apps/web/src/app/api/rest/codex/agent/grep/route.ts` — `POST` handler wrapping `trpc.codex.agent.grepRelevantCode`

### Cleanup

- [ ] Verify `npm run type-check` passes
- [ ] Verify `npm run build` passes for `@app/web` and `@shared/rest`

## 4. Testing Checklist

### Happy Path

- [ ] `POST /api/rest/codex/agent/grep` with valid `workspaceId`, `repositoryId`, and `taskDescription` returns 200 with `summary`, `context`, `chunks[]`, `totalFound`, and `timing`
- [ ] `chunks` array contains scored results with `filePath`, `content`, `symbolName`, `score`, and `matchChannel`
- [ ] `timing` object has all fields populated: `summarizeMs`, `contextCheckMs`, `searchMs`, `totalMs`
- [ ] `summary.semanticQueries` has 1-5 entries, `summary.keywords` has up to 10

### Validation

- [ ] Empty `taskDescription` returns 400 (Zod validation)
- [ ] `taskDescription` over 5000 chars returns 400
- [ ] Missing `workspaceId` or `repositoryId` returns 400

### Edge Cases

- [ ] Non-existent `repositoryId` returns `context.ready: false`, `context.repositoryExists: false`, empty `chunks`
- [ ] Repository with 0 embedded chunks returns `context.ready: false`, empty `chunks`
- [ ] Repository belonging to a different `workspaceId` returns `context.repositoryExists: false`
- [ ] Vague task description (e.g. "improve things") still returns results via semantic fallback
- [ ] LLM timeout (>15s) gracefully falls back to naive keyword extraction, does not error
- [ ] LLM returns malformed JSON — falls back to naive extraction, does not error
- [ ] `maxResults: 1` returns exactly 1 chunk (the highest scored)
- [ ] Duplicate chunks across search channels are deduplicated (same chunk ID appears once with merged `matchChannel`)

### Type Safety

- [ ] `npm run type-check` passes with no new errors
- [ ] All new Zod schemas have corresponding `z.infer` type exports
- [ ] `AgentGrepResult` type is assignable from `grepRelevantCode()` return value

### Build

- [ ] `npm run build --workspace @shared/rest` succeeds
- [ ] `npm run build --workspace @app/web` succeeds
- [ ] `npm run build --workspace @app/codex` succeeds (no broken imports)
