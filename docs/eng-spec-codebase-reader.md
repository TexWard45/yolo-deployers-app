# Engineering Spec: Codebase Reader Service

## 1. Job to Be Done

**Who:** Developers and AI agents within a workspace that need to search, understand, and navigate codebases from multiple source control platforms.

**What:** A service that ingests source code from pluggable repository sources (GitHub, GitLab, Bitbucket, Azure DevOps, local git, ZIP uploads), parses it into semantically meaningful chunks via Tree-sitter AST analysis, generates contextually enriched vector embeddings (no LLM calls), and exposes hybrid search combining semantic, keyword, and symbol lookup channels with optional reranking.

**Why:** Searching code across multiple repositories and providers is fragmented. Developers waste time context-switching between platforms. AI agents need structured, provenance-rich code retrieval to provide accurate answers. Existing solutions either require LLM calls in the indexing pipeline (expensive, non-deterministic) or use naive sliding-window chunking (loses semantic boundaries).

**Success Criteria:**
- Repositories from any supported source can be registered, synced, and searched through a single API
- AST-based chunking produces semantically complete units (functions, classes, types) with full metadata
- Hybrid search returns relevant results with full provenance (repo, file, lines, author, confidence)
- Incremental sync re-embeds only changed chunks (60-80% embedding cost savings on typical edits)
- End-to-end indexing pipeline uses zero LLM calls — only AST parsing + embedding model
- Search latency < 500ms for p95 queries across 100k+ chunks

---

## 2. Proposed Flow / Architecture

### 2.1 New App: `apps/codex`

A standalone Temporal worker + API service within the monorepo. This keeps the indexing pipeline (long-running, CPU-intensive AST parsing) isolated from the web app.

```
apps/codex/
  src/
    adapters/              # Source adapter implementations
      github.adapter.ts
      gitlab.adapter.ts
      bitbucket.adapter.ts
      azure-devops.adapter.ts
      local-git.adapter.ts
      archive.adapter.ts
      types.ts             # ISourceAdapter interface
    parser/
      tree-sitter.ts       # AST parsing + chunk extraction
      chunk-splitter.ts    # Large function splitting logic
      metadata.ts          # Structured metadata extraction
      languages/           # Per-language Tree-sitter queries
        typescript.ts
        python.ts
        java.ts
        go.ts
        rust.ts
    embedder/
      embedder.ts          # Batch embedding with retry/backoff
      context-header.ts    # Contextual header builder
      diff.ts              # Content-hash diffing logic
    search/
      hybrid.ts            # RRF fusion orchestrator
      semantic.ts          # pgvector cosine similarity
      keyword.ts           # PostgreSQL FTS queries
      symbol.ts            # Exact symbol lookup
      reranker.ts          # Optional cross-encoder reranker
    workflows/
      sync-repo.workflow.ts       # Full repo sync orchestration
      incremental-sync.workflow.ts # Diff-based incremental sync
      embed-chunks.workflow.ts     # Batch embedding workflow
      registry.ts
      index.ts
    activities/
      clone.activity.ts
      parse.activity.ts
      embed.activity.ts
      cleanup.activity.ts
      index.ts
    worker.ts
    config.ts
```

### 2.2 Data Model Changes

All new models scoped to the `codex_` prefix to avoid collision with existing domain models. New schema file: `packages/database/prisma/codex.schema.prisma`.

```prisma
// ─── Source & Repository ───

enum CodexSourceType {
  GITHUB
  GITLAB
  BITBUCKET
  AZURE_DEVOPS
  LOCAL_GIT
  ARCHIVE
}

enum CodexSyncMode {
  WEBHOOK
  CRON
  MANUAL
}

enum CodexSyncStatus {
  IDLE
  SYNCING
  FAILED
  COMPLETED
}

enum CodexChunkType {
  FUNCTION
  METHOD
  CLASS
  TYPE
  INTERFACE
  ENUM
  ROUTE_HANDLER
  MODULE      // top-level code
  FRAGMENT    // split piece of a large function
}

enum CodexEmbeddingStatus {
  PENDING
  EMBEDDED
  FAILED
  STALE       // model version changed, needs re-embed
}

enum CodexSymbolRefKind {
  CALLS
  IMPORTS
  EXTENDS
  IMPLEMENTS
}

model CodexRepository {
  id             String           @id @default(cuid())
  workspaceId    String
  workspace      Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  // Source configuration
  sourceType     CodexSourceType
  sourceUrl      String           // clone URL or path
  defaultBranch  String           @default("main")
  credentials    Json?            // encrypted PAT/token config (adapter-specific)

  // Sync configuration
  syncMode       CodexSyncMode    @default(MANUAL)
  cronExpression String?          // e.g. "0 */6 * * *"
  syncStatus     CodexSyncStatus  @default(IDLE)
  lastSyncAt     DateTime?
  lastSyncCommit String?          // HEAD commit SHA after last sync
  lastSyncError  String?

  // File filtering
  extensionAllowlist String[]     @default([])  // e.g. [".ts", ".py", ".go"]
  pathDenylist       String[]     @default([])  // e.g. ["node_modules", "dist"]
  maxFileSizeBytes   Int          @default(1048576)  // 1MB default

  // Metadata
  displayName    String
  description    String?
  language       String?          // primary language (detected)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  files   CodexFile[]
  syncs   CodexSyncLog[]

  @@index([workspaceId])
  @@index([sourceType])
}

model CodexSyncLog {
  id            String          @id @default(cuid())
  repositoryId  String
  repository    CodexRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  status        CodexSyncStatus
  startedAt     DateTime        @default(now())
  completedAt   DateTime?
  commitBefore  String?
  commitAfter   String?
  filesChanged  Int             @default(0)
  chunksCreated Int             @default(0)
  chunksUpdated Int             @default(0)
  chunksDeleted Int             @default(0)
  embeddingsGen Int             @default(0)
  errorMessage  String?

  @@index([repositoryId])
}

model CodexFile {
  id            String          @id @default(cuid())
  repositoryId  String
  repository    CodexRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  filePath      String          // relative path within repo
  language      String          // detected from extension/content
  contentHash   String          // SHA-256 of file content
  lastCommitSha String?
  lastCommitAt  DateTime?
  lastAuthor    String?

  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  chunks CodexChunk[]

  @@unique([repositoryId, filePath])
  @@index([repositoryId])
  @@index([language])
}

model CodexChunk {
  id            String              @id @default(cuid())
  fileId        String
  file          CodexFile           @relation(fields: [fileId], references: [id], onDelete: Cascade)

  // Chunk identity
  chunkType     CodexChunkType
  symbolName    String?             // function name, class name, etc.
  lineStart     Int
  lineEnd       Int
  content       String              // raw code content
  contentHash   String              // SHA-256 for diff detection

  // AST-extracted metadata (no LLM)
  parameters    String[]            @default([])
  returnType    String?
  imports       String[]            @default([])
  exportType    String?             // "default", "named", "none"
  isAsync       Boolean             @default(false)
  docstring     String?             // extracted JSDoc/docstring if present

  // Hierarchy
  parentChunkId String?
  parentChunk   CodexChunk?         @relation("ChunkHierarchy", fields: [parentChunkId], references: [id], onDelete: SetNull)
  childChunks   CodexChunk[]        @relation("ChunkHierarchy")

  // Embedding
  embedding           Unsupported("vector(1536)")?
  embeddingStatus     CodexEmbeddingStatus @default(PENDING)
  embeddingModelId    String?              // e.g. "text-embedding-3-small-v1"
  embeddedAt          DateTime?

  // Full-text search
  searchVector  Unsupported("tsvector")?

  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  // V2: Symbol references
  referencesFrom CodexSymbolRef[]   @relation("RefSource")
  referencesTo   CodexSymbolRef[]   @relation("RefTarget")

  @@index([fileId])
  @@index([chunkType])
  @@index([symbolName])
  @@index([contentHash])
}

// V2 — Symbol Reference / Call Graph (schema ready from day 1)
model CodexSymbolRef {
  id            String              @id @default(cuid())
  sourceChunkId String
  sourceChunk   CodexChunk          @relation("RefSource", fields: [sourceChunkId], references: [id], onDelete: Cascade)
  targetChunkId String
  targetChunk   CodexChunk          @relation("RefTarget", fields: [targetChunkId], references: [id], onDelete: Cascade)
  kind          CodexSymbolRefKind
  line          Int?                // line in source where reference occurs

  @@unique([sourceChunkId, targetChunkId, kind])
  @@index([sourceChunkId])
  @@index([targetChunkId])
}
```

**pgvector setup:** Requires a migration to run `CREATE EXTENSION IF NOT EXISTS vector;` and manual SQL for the vector column index:
```sql
CREATE INDEX codex_chunk_embedding_idx ON "CodexChunk"
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX codex_chunk_search_vector_idx ON "CodexChunk"
  USING gin ("searchVector");
```

**Relation to existing models:** `CodexRepository` links to `Workspace` — repositories are workspace-scoped, following the existing multi-tenant pattern.

### 2.3 API Layer — New tRPC Router: `codex`

Location: `packages/rest/src/routers/codex.ts`

Registered in `packages/rest/src/root.ts` under `appRouter.codex.*`.

#### Procedures

| Procedure | Type | Input | Description |
|---|---|---|---|
| `codex.repository.create` | mutation | `CreateCodexRepositorySchema` | Register a new repository source |
| `codex.repository.list` | query | `{ workspaceId }` | List repos in workspace |
| `codex.repository.get` | query | `{ id }` | Get repo details + sync status |
| `codex.repository.update` | mutation | `UpdateCodexRepositorySchema` | Update sync config, filters |
| `codex.repository.delete` | mutation | `{ id }` | Remove repo + cascade all data |
| `codex.repository.sync` | mutation | `{ id }` | Trigger manual sync |
| `codex.search` | query | `CodexSearchSchema` | Hybrid search across repos |
| `codex.chunk.get` | query | `{ id }` | Get single chunk with context |
| `codex.chunk.context` | query | `{ id, before?, after? }` | Get surrounding chunks in same file |
| `codex.sync.logs` | query | `{ repositoryId, limit? }` | Sync history for a repo |
| `codex.stats` | query | `{ workspaceId }` | Aggregate stats (repos, files, chunks) |

#### Search Input Schema

```typescript
const CodexSearchSchema = z.object({
  workspaceId: z.string(),
  query: z.string().min(1).max(1000),
  repositoryIds: z.array(z.string()).optional(),    // scope to specific repos
  languages: z.array(z.string()).optional(),         // filter by language
  chunkTypes: z.array(z.nativeEnum(CodexChunkType)).optional(),
  symbolName: z.string().optional(),                 // exact symbol match channel
  channels: z.object({
    semantic: z.boolean().default(true),
    keyword: z.boolean().default(true),
    symbol: z.boolean().default(true),
  }).optional(),
  rerank: z.boolean().default(false),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});
```

#### Search Response Shape

```typescript
interface CodexSearchResult {
  chunks: Array<{
    id: string;
    content: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    language: string;
    chunkType: CodexChunkType;
    symbolName: string | null;
    repository: {
      id: string;
      displayName: string;
      sourceType: CodexSourceType;
    };
    lastCommitSha: string | null;
    lastAuthor: string | null;
    lastCommitAt: string | null;
    score: number;           // RRF fusion score
    matchChannel: string;    // which channel(s) contributed
  }>;
  total: number;
  query: string;
  timing: {
    semanticMs: number;
    keywordMs: number;
    symbolMs: number;
    rerankMs: number | null;
    totalMs: number;
  };
}
```

### 2.4 REST Endpoints

Location: `apps/web/src/app/api/rest/codex/`

| Endpoint | Method | Maps to |
|---|---|---|
| `/api/rest/codex/repository` | GET | `codex.repository.list` |
| `/api/rest/codex/repository` | POST | `codex.repository.create` |
| `/api/rest/codex/repository/[id]` | GET | `codex.repository.get` |
| `/api/rest/codex/repository/[id]` | PUT | `codex.repository.update` |
| `/api/rest/codex/repository/[id]` | DELETE | `codex.repository.delete` |
| `/api/rest/codex/repository/[id]/sync` | POST | `codex.repository.sync` |
| `/api/rest/codex/search` | POST | `codex.search` |
| `/api/rest/codex/chunk/[id]` | GET | `codex.chunk.get` |
| `/api/rest/codex/sync/[repoId]/logs` | GET | `codex.sync.logs` |

### 2.5 Source Adapter Interface

```typescript
interface ISourceAdapter {
  type: CodexSourceType;

  /** Clone repository to local disk. Returns path to cloned directory. */
  clone(config: CloneConfig): Promise<{ localPath: string; headCommit: string }>;

  /** Fetch latest changes. Returns new HEAD commit. */
  pull(localPath: string): Promise<{ headCommit: string }>;

  /** Get list of files changed between two commits. */
  diff(localPath: string, fromCommit: string, toCommit: string): Promise<FileDiff[]>;

  /** Get commit history for a specific file. */
  fileHistory(localPath: string, filePath: string, limit?: number): Promise<CommitInfo[]>;

  /** Validate credentials and connectivity. */
  validate(config: AdapterConfig): Promise<{ valid: boolean; error?: string }>;
}

interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;  // for renames
}
```

### 2.6 Workflow Orchestration (Temporal)

#### Sync Workflow (`sync-repo.workflow.ts`)

```
1. Validate adapter credentials
2. Clone or pull repository (adapter.clone / adapter.pull)
3. Get diff (full file list for initial, changed files for incremental)
4. For deleted files → cascade delete CodexFile + CodexChunk records
5. For renamed files → delete old records, treat as new
6. For added/modified files → filter by allowlist/denylist/size
7. Fan out: parse each changed file (activity)
   a. Tree-sitter AST parse → extract chunks
   b. Compute content hash per chunk
   c. Diff against existing chunks by hash
   d. Upsert CodexFile + CodexChunk records
   e. Mark changed chunks as embeddingStatus=PENDING
8. Fan out: batch embed pending chunks (activity)
   a. Build contextual header per chunk
   b. Call embedding API in batches (retry + backoff)
   c. Update embedding + embeddingStatus + embeddedAt
   d. Update tsvector for keyword search
9. Update CodexRepository sync status + lastSyncCommit
10. Write CodexSyncLog entry
```

#### Task Queue

New Temporal task queue: `codex-sync-queue` (registered in `packages/env` and `apps/codex/src/config.ts`).

### 2.7 Frontend Pages

| Page | Type | Description |
|---|---|---|
| `/workspace/[slug]/codex` | Server component | Dashboard: repo list, sync status, stats |
| `/workspace/[slug]/codex/search` | Client component | Search interface with filters, results |
| `/workspace/[slug]/codex/repository/new` | Client component | Add repository form (source type picker, credentials) |
| `/workspace/[slug]/codex/repository/[id]` | Server component | Repo detail: files, sync logs, settings |
| `/workspace/[slug]/codex/chunk/[id]` | Server component | Chunk viewer with syntax highlighting + context |

### 2.8 Dependencies

| Package | Purpose | Location |
|---|---|---|
| `web-tree-sitter` | AST parsing in Node.js | `apps/codex` |
| `tree-sitter-typescript` | TS/JS grammar | `apps/codex` |
| `tree-sitter-python` | Python grammar | `apps/codex` |
| `tree-sitter-go` | Go grammar | `apps/codex` |
| `tree-sitter-java` | Java grammar | `apps/codex` |
| `tree-sitter-rust` | Rust grammar | `apps/codex` |
| `pgvector` | Vector ops for Prisma/pg | `packages/database` |
| `openai` (or embedding provider SDK) | Embedding API calls | `apps/codex` |
| `simple-git` | Git operations (clone, pull, diff) | `apps/codex` |
| `@temporalio/*` | Workflow orchestration | `apps/codex` |

#### Environment Variables (new)

```
CODEX_EMBEDDING_API_KEY     — API key for embedding provider
CODEX_EMBEDDING_MODEL       — e.g. "text-embedding-3-small"
CODEX_EMBEDDING_DIMENSIONS  — e.g. 1536
CODEX_CLONE_BASE_PATH       — local directory for cloned repos
CODEX_RERANKER_ENABLED      — toggle cross-encoder reranker
CODEX_RERANKER_MODEL        — reranker model identifier
```

Added to `packages/env/src/codex.ts` and exported from `@shared/env/codex`.

### 2.9 Flow Diagram — Search Request

```
1. User/agent sends POST /api/rest/codex/search with query + filters
2. Route handler calls codex.search procedure via createCaller
3. Procedure validates input against CodexSearchSchema
4. Parallel fan-out to enabled channels:
   a. Semantic: embed query → pgvector cosine similarity search
   b. Keyword: parse query → PostgreSQL FTS against tsvector
   c. Symbol: exact match on symbolName column
5. Reciprocal Rank Fusion merges results from all channels
6. (Optional) Cross-encoder reranker re-scores top-N fused results
7. Enrich results with file metadata, repo info, last commit info
8. Return CodexSearchResult with timing telemetry
```

### 2.10 Flow Diagram — Incremental Sync

```
1. Webhook/cron/manual triggers sync for repository R
2. Temporal workflow starts on codex-sync-queue
3. Adapter.pull(R.localPath) → new HEAD commit
4. Adapter.diff(R.localPath, R.lastSyncCommit, newHead) → changed files
5. For each deleted file:
   - Delete CodexFile (cascade deletes chunks + embeddings)
6. For each renamed file:
   - Delete old CodexFile, create new one
7. For each added/modified file passing filters:
   - Read file content, compute file contentHash
   - If hash unchanged → skip (no-op)
   - Tree-sitter parse → extract chunks with metadata
   - For each chunk, compute contentHash
   - Compare against existing chunks for this file:
     - New chunks → insert with embeddingStatus=PENDING
     - Changed chunks (hash differs) → update content + metadata, set PENDING
     - Unchanged chunks → skip embedding
     - Missing chunks (were in DB but not in new parse) → delete
8. Batch embed all PENDING chunks
9. Update repository lastSyncCommit, lastSyncAt, syncStatus
10. Write sync log with counts
```

---

## 3. Task Checklist

### Schema / Data

- [ ] Create `packages/database/prisma/codex.schema.prisma` with all Codex models, enums, and indexes
- [ ] Add pgvector extension migration (`CREATE EXTENSION vector`)
- [ ] Add raw SQL migration for vector index (ivfflat) and GIN index on tsvector
- [ ] Run `npm run db:generate` to regenerate types into `@shared/types`
- [ ] Add `Workspace.codexRepositories` relation to `workspace.schema.prisma`

### Zod Schemas (`packages/types/src/schemas/`)

- [ ] Create `packages/types/src/schemas/codex.ts` with all input schemas:
  - `CreateCodexRepositorySchema`
  - `UpdateCodexRepositorySchema`
  - `CodexSearchSchema`
  - `CodexChunkQuerySchema`
  - `CodexSyncLogsQuerySchema`
- [ ] Export new schemas from `packages/types/src/schemas/index.ts`

### Environment (`packages/env/`)

- [ ] Create `packages/env/src/codex.ts` with Codex-specific env vars
- [ ] Export `codexEnv` from `packages/env/src/index.ts`
- [ ] Update `.env.example` with new Codex env vars

### Source Adapters (`apps/codex/src/adapters/`)

- [ ] Define `ISourceAdapter` interface in `types.ts`
- [ ] Implement `GitAdapter` (shared git logic for GitHub/GitLab/Bitbucket/Azure) using `simple-git`
- [ ] Implement `GithubAdapter` extending GitAdapter (PAT/GitHub App auth, API-based metadata)
- [ ] Implement `GitlabAdapter` extending GitAdapter
- [ ] Implement `BitbucketAdapter` extending GitAdapter
- [ ] Implement `AzureDevOpsAdapter` extending GitAdapter
- [ ] Implement `LocalGitAdapter` (no clone, points to existing path)
- [ ] Implement `ArchiveAdapter` (extract ZIP/tarball, no git history)
- [ ] Create adapter factory: `getAdapter(sourceType) → ISourceAdapter`

### Parser (`apps/codex/src/parser/`)

- [ ] Set up `web-tree-sitter` initialization with WASM grammars
- [ ] Implement TypeScript/JavaScript Tree-sitter query definitions
- [ ] Implement Python Tree-sitter query definitions
- [ ] Implement Go Tree-sitter query definitions
- [ ] Implement Java Tree-sitter query definitions
- [ ] Implement Rust Tree-sitter query definitions
- [ ] Implement core `parseFile(content, language) → CodexChunk[]` function
- [ ] Implement large function splitting with overlap and `parentChunkId` linking
- [ ] Implement nested function/class-method extraction with hierarchy
- [ ] Implement metadata extraction: params, return type, imports, exports, docstrings
- [ ] Implement content hash computation (SHA-256) per chunk

### Embedder (`apps/codex/src/embedder/`)

- [ ] Implement contextual header builder (repo, path, language, chunk type, symbol, params, imports)
- [ ] Implement batch embedding function with retry and exponential backoff
- [ ] Implement chunk-level content-hash diffing (skip unchanged chunks)
- [ ] Implement tsvector generation for keyword search per chunk
- [ ] Implement embedding model version tracking

### Search (`apps/codex/src/search/`)

- [ ] Implement semantic search channel (embed query → pgvector cosine similarity)
- [ ] Implement keyword search channel (PostgreSQL FTS with GIN index)
- [ ] Implement symbol lookup channel (exact match on symbolName + optional chunkType filter)
- [ ] Implement Reciprocal Rank Fusion (RRF) merger
- [ ] Implement optional cross-encoder reranker (togglable via config)
- [ ] Implement result enrichment (provenance: repo, file, lines, author, confidence)

### Temporal Workflows (`apps/codex/src/workflows/`)

- [ ] Implement `syncRepo` workflow (full + incremental sync orchestration)
- [ ] Implement `embedChunks` workflow (batch embedding with progress tracking)
- [ ] Register workflow names in `registry.ts`
- [ ] Export workflows from `index.ts`

### Temporal Activities (`apps/codex/src/activities/`)

- [ ] Implement `cloneRepository` activity
- [ ] Implement `pullRepository` activity
- [ ] Implement `diffFiles` activity
- [ ] Implement `parseFile` activity (Tree-sitter → chunks → upsert DB)
- [ ] Implement `embedBatch` activity (embed pending chunks → update DB)
- [ ] Implement `cleanupDeletedFiles` activity (cascade delete stale records)
- [ ] Export activities from `index.ts`

### Codex Worker (`apps/codex/`)

- [ ] Create `apps/codex/package.json` with dependencies
- [ ] Create `apps/codex/tsconfig.json` extending `@shared/tsconfig/library.json`
- [ ] Implement `config.ts` (load env from `@shared/env/codex`)
- [ ] Implement `worker.ts` (register Temporal worker on `codex-sync-queue`)

### tRPC Router (`packages/rest/src/routers/`)

- [ ] Create `packages/rest/src/routers/codex.ts` with all procedures
- [ ] Register `codexRouter` in `packages/rest/src/root.ts`
- [ ] Implement `codex.repository.create` — validate adapter, persist config
- [ ] Implement `codex.repository.list` — workspace-scoped query
- [ ] Implement `codex.repository.get` — include sync status + file count
- [ ] Implement `codex.repository.update` — update filters, sync config
- [ ] Implement `codex.repository.delete` — cascade delete all data
- [ ] Implement `codex.repository.sync` — trigger Temporal workflow
- [ ] Implement `codex.search` — orchestrate hybrid search pipeline
- [ ] Implement `codex.chunk.get` — single chunk with full metadata
- [ ] Implement `codex.chunk.context` — surrounding chunks in same file
- [ ] Implement `codex.sync.logs` — paginated sync history
- [ ] Implement `codex.stats` — aggregate counts for workspace

### REST Routes (`apps/web/src/app/api/rest/codex/`)

- [ ] Create `/api/rest/codex/repository/route.ts` (GET, POST)
- [ ] Create `/api/rest/codex/repository/[id]/route.ts` (GET, PUT, DELETE)
- [ ] Create `/api/rest/codex/repository/[id]/sync/route.ts` (POST)
- [ ] Create `/api/rest/codex/search/route.ts` (POST)
- [ ] Create `/api/rest/codex/chunk/[id]/route.ts` (GET)
- [ ] Create `/api/rest/codex/sync/[repoId]/logs/route.ts` (GET)

### Frontend / UI

- [ ] Create codex dashboard page: `/workspace/[slug]/codex/page.tsx` (server component)
- [ ] Create repository list component with sync status indicators
- [ ] Create add repository page with source type picker + credential form
- [ ] Create repository detail page with file browser, sync logs, settings
- [ ] Create search page with query input, language/type filters, results list
- [ ] Create search result card component (syntax-highlighted code, provenance metadata)
- [ ] Create chunk viewer page with full context + syntax highlighting
- [ ] Add codex navigation item to workspace sidebar

### Wiring

- [ ] Add `@shared/database`, `@shared/rest`, `@shared/types`, `@shared/env` as dependencies in `apps/codex/package.json`
- [ ] Add `transpilePackages` for shared packages in `apps/web/next.config.ts` (already done for existing ones)
- [ ] Add Turborepo pipeline entry for `apps/codex` in `turbo.json`

### CI / Cleanup

- [ ] Create `.github/workflows/build-codex.yml` (db:generate → type-check → lint → build)
- [ ] Update `CLAUDE.md` with Codex architecture, commands, and patterns
- [ ] Update `.env.example` with all new env vars

---

## 4. Testing Checklist

### Happy Path

- [ ] Register a GitHub repository via API → repository created with correct config
- [ ] Trigger manual sync → files cloned, parsed into chunks, embeddings generated
- [ ] Search by natural language query → returns semantically relevant chunks with provenance
- [ ] Search by exact symbol name → returns matching function/class chunk
- [ ] Search by error message string → keyword channel returns exact match
- [ ] Incremental sync after file change → only modified chunks re-embedded
- [ ] Delete repository → all files, chunks, embeddings cascade-deleted

### Validation

- [ ] Creating repository with invalid source URL → clear validation error
- [ ] Search with empty query → rejected by Zod schema
- [ ] Repository with invalid credentials → adapter.validate returns error before clone
- [ ] File exceeding maxFileSizeBytes → skipped during parse with log entry
- [ ] Extension not in allowlist → file skipped during sync

### Edge Cases

- [ ] File renamed → old chunks deleted, new chunks created (not duplicated)
- [ ] File deleted from repo → all chunks cascade-deleted on next sync
- [ ] Very large function (500+ lines) → split into linked fragments with parentChunkId
- [ ] Nested class with methods → class chunk + separate method chunks linked to parent
- [ ] Empty repository (no parseable files) → sync completes with 0 chunks, no error
- [ ] Concurrent sync requests for same repo → second request rejected (repo already SYNCING)
- [ ] Binary file in repo → skipped by extension filter or detected and skipped
- [ ] Embedding API rate limit hit → retry with exponential backoff, eventually succeeds

### Auth / Permissions

- [ ] Only workspace members can list/create/sync repositories
- [ ] Only workspace OWNER/ADMIN can delete repositories
- [ ] Search results scoped to repositories in user's workspace only
- [ ] Repository credentials stored encrypted, never returned in API responses

### Search Quality

- [ ] Hybrid search outperforms single-channel (semantic-only or keyword-only) on test corpus
- [ ] RRF fusion correctly merges results when same chunk appears in multiple channels
- [ ] Reranker (when enabled) improves precision on ambiguous queries
- [ ] Timing telemetry accurate and returned in response

### Type Safety

- [ ] `npm run type-check` passes with all new code
- [ ] All Prisma-generated types correctly exported from `@shared/types`
- [ ] Zod schemas align with Prisma model shapes
- [ ] tRPC procedure inputs/outputs fully typed end-to-end

### Build / CI

- [ ] `npm run build` succeeds (all apps including codex)
- [ ] `npm run lint` passes
- [ ] `build-codex.yml` CI workflow passes: db:generate → type-check → lint → build
- [ ] `build-web.yml` still passes with new codex routes added
