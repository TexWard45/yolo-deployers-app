# Implementation Plan: Codebase Reader (Codex) Service

## Context

We're building a Codebase Reader service that ingests source code from multiple repository sources, parses it into semantic chunks via Tree-sitter AST, generates vector embeddings (no LLM), and exposes hybrid search. The full spec lives at `docs/eng-spec-codebase-reader.md`. Cloned repos are stored on local filesystem at `CODEX_CLONE_BASE_PATH`.

---

## Phase 0 — Schema, Types, Environment `[STATUS: COMPLETE]`

**Goal:** Data models, Zod schemas, env contracts. Verifiable via `db:generate` + `type-check`.

### Tasks

- [x] Create `packages/database/prisma/codex.schema.prisma` — All Codex models + enums. `Unsupported("vector(1536)")` for embedding, `Unsupported("tsvector")` for searchVector.
- [x] Create `packages/types/src/schemas/codex.ts` — All Zod input schemas (CreateCodexRepositorySchema, UpdateCodexRepositorySchema, CodexSearchSchema, etc.)
- [x] Create `packages/env/src/codex.ts` — codexEnv via `createEnv` (embedding API key/model/dimensions, clone path, reranker, Temporal vars)
- [x] Modify `packages/database/prisma/workspace.schema.prisma` — Add `codexRepositories CodexRepository[]` to Workspace
- [x] Modify `packages/types/src/schemas/index.ts` — Re-export codex schemas
- [x] Modify `packages/types/src/index.ts` — Ensure new Prisma types are exported
- [x] Modify `packages/env/src/index.ts` — Export `codexEnv`
- [x] Modify `packages/env/package.json` — Add `"./codex"` export
- [x] Modify `.env.example` — Add CODEX_* vars
- [ ] Run migration: `prisma migrate dev --create-only` to generate table SQL, then manually append `CREATE EXTENSION IF NOT EXISTS vector;`, ivfflat index on `CodexChunk.embedding`, GIN index on `CodexChunk.searchVector`

### Verify: `npm run db:generate` + `npm run type-check` — PASSED

---

## Phase 1 — Codex Worker Scaffold + Source Adapters `[STATUS: COMPLETE]`

**Goal:** `apps/codex` Temporal worker connects to `codex-sync-queue`. GitHub + LocalGit adapters work.

### Tasks

- [x] Create `apps/codex/package.json` — @app/codex, deps: @temporalio/*, simple-git, openai, @shared/env, @shared/types, @shared/database
- [x] Create `apps/codex/tsconfig.json` — Extends `@shared/tsconfig/library.json`
- [x] Create `apps/codex/src/config.ts` — Load from `@shared/env/codex`
- [x] Create `apps/codex/src/worker.ts` — Follow `apps/queue/src/worker.ts` pattern exactly
- [x] Create `apps/codex/src/adapters/types.ts` — `ISourceAdapter` interface
- [x] Create `apps/codex/src/adapters/git.adapter.ts` — Shared base using `simple-git`
- [x] Create `apps/codex/src/adapters/github.adapter.ts` — PAT auth
- [x] Create `apps/codex/src/adapters/local-git.adapter.ts` — Points to existing path
- [x] Create `apps/codex/src/adapters/factory.ts` — `getAdapter(sourceType)`
- [x] Create stub files for GitLab, Bitbucket, Azure, Archive adapters (throw "not implemented")
- [x] Create placeholder `workflows/index.ts`, `workflows/registry.ts`, `activities/index.ts`
- [x] Modify root `package.json` — Add `dev:codex` script
- [ ] Run verification: Worker starts, connects to Temporal, GitHub adapter clones a public repo

---

## Phase 2 — Tree-sitter AST Parser `[STATUS: NOT STARTED]`

**Goal:** `parseFile(content, language) → ParsedChunk[]` with full metadata. Parallel with Phase 1.

### Tasks

- [ ] Create `apps/codex/src/parser/tree-sitter.ts` — WASM init + `parseFile()` entry point
- [ ] Create `apps/codex/src/parser/languages/typescript.ts` — TS/JS queries
- [ ] Create `apps/codex/src/parser/languages/python.ts`
- [ ] Create `apps/codex/src/parser/languages/go.ts`
- [ ] Create `apps/codex/src/parser/languages/java.ts`
- [ ] Create `apps/codex/src/parser/languages/rust.ts`
- [ ] Create `apps/codex/src/parser/languages/index.ts` — Language registry
- [ ] Create `apps/codex/src/parser/chunk-splitter.ts` — Split large functions into FRAGMENTs
- [ ] Create `apps/codex/src/parser/metadata.ts` — Extract params, return type, imports, exports, docstring
- [ ] Run verification: Unit tests against fixture source files for each language

### Risk: WASM grammar files need a copy/bundle strategy at build time.

---

## Phase 3 — Temporal Workflows + Activities (Sync Pipeline) `[STATUS: NOT STARTED]`

**Goal:** Full sync pipeline: clone/pull → parse → upsert DB. Chunks created as `PENDING`. Depends on Phases 1+2.

### Tasks

- [ ] Create `apps/codex/src/activities/clone.activity.ts` — Clone/pull via adapter
- [ ] Create `apps/codex/src/activities/parse.activity.ts` — Parse file, diff chunks by content hash, upsert CodexFile + CodexChunk
- [ ] Create `apps/codex/src/activities/cleanup.activity.ts` — Delete removed files (cascade)
- [ ] Create `apps/codex/src/workflows/sync-repo.workflow.ts` — Orchestrate: pull → diff → cleanup → parse fan-out → embed → log
- [ ] Create `apps/codex/src/workflows/registry.ts` — Register workflow names
- [ ] Create `apps/codex/src/client.ts` — Test script to trigger workflows manually
- [ ] Run verification: Trigger sync against a real repo, check CodexFile/CodexChunk rows in DB. Re-sync to verify incremental behavior.

### Key constraint: Workflows can't import `@shared/database` (Temporal sandboxing). All DB ops in activities only.

---

## Phase 4 — Embedder `[STATUS: NOT STARTED]`

**Goal:** Embed PENDING chunks with contextual headers. Depends on Phase 3.

### Tasks

- [ ] Create `apps/codex/src/embedder/context-header.ts` — Build structured prefix from AST metadata
- [ ] Create `apps/codex/src/embedder/embedder.ts` — Batch embedding with retry/backoff (OpenAI SDK)
- [ ] Create `apps/codex/src/embedder/diff.ts` — Find PENDING chunks, mark embedded
- [ ] Create `apps/codex/src/embedder/tsvector.ts` — Raw SQL to update searchVector
- [ ] Create `apps/codex/src/activities/embed.activity.ts` — Orchestrate: load pending → build headers → embed → write via raw SQL → update tsvector
- [ ] Modify `apps/codex/src/workflows/sync-repo.workflow.ts` — Add embed step after parse fan-out
- [ ] Run verification: After sync, chunks have non-null embeddings. Re-sync unchanged files → no re-embedding.

### All embedding/tsvector writes use `prisma.$executeRaw` with `::vector` cast.

---

## Phase 5 — Hybrid Search Pipeline `[STATUS: NOT STARTED]`

**Goal:** Three-channel search + RRF fusion. **Search logic lives in `packages/rest`** (alongside the tRPC router) so it can access `ctx.prisma`.

### Tasks

- [ ] Create `packages/rest/src/routers/codex/search.ts` — semanticSearch, keywordSearch, symbolSearch, rrfFusion, hybridSearch. All accept `prisma` as parameter. Raw SQL for vector/FTS queries.
- [ ] Create `packages/rest/src/routers/codex/reranker.ts` — Optional cross-encoder (stub initially)
- [ ] Note: Query embedding (for semantic search) requires OpenAI SDK → `packages/rest` needs `openai` dependency.
- [ ] Run verification: Unit tests with seeded chunks. Each channel returns expected results. RRF correctly merges overlapping results.

---

## Phase 6 — tRPC Router + REST Endpoints `[STATUS: NOT STARTED]`

**Goal:** Full API surface. Depends on Phase 5.

### Tasks

- [ ] Create `packages/rest/src/routers/codex/router.ts` — All 11 procedures from spec
- [ ] Create `packages/rest/src/routers/codex/index.ts` — Re-export router
- [ ] Create REST routes in `apps/web/src/app/api/rest/codex/` — 6 route files mapping to tRPC procedures
- [ ] Modify `packages/rest/src/root.ts` — Register `codexRouter`
- [ ] Modify `packages/rest/package.json` — Add `openai` + `@temporalio/client` deps
- [ ] Run verification: Curl all REST endpoints. Full flow: create repo → sync → search → view chunk.

### Trigger sync decision: `codex.repository.sync` creates a Temporal Client connection from the web process to start the workflow.

---

## Phase 7 — Frontend Pages `[STATUS: NOT STARTED]`

**Goal:** UI for repo management and code search.

### Tasks

- [ ] Create `apps/web/src/app/workspace/[slug]/codex/page.tsx` — Dashboard (server component)
- [ ] Create `apps/web/src/app/workspace/[slug]/codex/repository/new/page.tsx` — Add repo form (client)
- [ ] Create `apps/web/src/app/workspace/[slug]/codex/repository/[id]/page.tsx` — Repo detail (server)
- [ ] Create `apps/web/src/app/workspace/[slug]/codex/search/page.tsx` — Search interface (client)
- [ ] Create `apps/web/src/app/workspace/[slug]/codex/chunk/[id]/page.tsx` — Chunk viewer (server)
- [ ] Create `apps/web/src/components/codex/RepositoryCard/` — Repo card component
- [ ] Create `apps/web/src/components/codex/SearchResultCard/` — Search result with syntax highlight
- [ ] Modify workspace sidebar — Add "Codex" navigation link

---

## Phase 8 — CI + Remaining Adapters + Polish `[STATUS: NOT STARTED]`

### Tasks

- [ ] Create `.github/workflows/build-codex.yml` — Follow build-queue.yml pattern
- [ ] Create remaining adapters: gitlab, bitbucket, azure-devops, archive (full implementations)
- [ ] Modify `apps/codex/src/adapters/factory.ts` — Wire all adapters
- [ ] Modify `CLAUDE.md` — Document codex architecture, commands, dependency flow

---

## Key Patterns to Reuse

| Pattern | Source file |
|---|---|
| Temporal worker setup | `apps/queue/src/worker.ts` |
| Temporal config loading | `apps/queue/src/config.ts` |
| Workflow definition | `apps/queue/src/workflows/template-greeting.workflow.ts` |
| Activity definition | `apps/queue/src/activities/template-greeting.activity.ts` |
| Workflow registry | `apps/queue/src/workflows/registry.ts` |
| tRPC router with auth checks | `packages/rest/src/routers/workspace.ts` |
| Zod schema definitions | `packages/types/src/schemas/index.ts` |
| Env schema with createEnv | `packages/env/src/queue.ts` |
| REST route handler | `apps/web/src/app/api/rest/workspace/route.ts` |
| Prisma client singleton | `packages/database/src/index.ts` |

## Verification Plan

1. `npm run db:generate` — Prisma types regenerate
2. `npm run type-check` — All packages pass
3. `npm run lint` — Clean
4. `npm run build` — All apps build
5. Start codex worker → connects to Temporal
6. Create a repo → trigger sync → chunks appear in DB with embeddings
7. Search by query → returns relevant results with provenance
8. Full UI flow: dashboard → add repo → sync → search → view chunk
