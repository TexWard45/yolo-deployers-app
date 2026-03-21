# AGENTS.md

## Project Overview

Monorepo microservice architecture using npm workspaces + Turborepo.

## Tech Stack

- **Next.js 16** — app framework (turbopack for dev)
- **Prisma 7.4** — ORM with `prisma-client` generator (NOT `prisma-client-js`)
- **Zod 4** — runtime validation schemas
- **TypeScript 5.9** — strict mode everywhere
- **npm** — package manager with workspaces
- **Turborepo** — monorepo task orchestration

## Architecture

```
apps/           → microservice apps (Next.js, APIs, workers, etc.)
packages/       → shared internal packages
```

### Packages

- **`@shared/types`** — single source of truth for ALL types. Prisma generates model types here (`packages/types/src/prisma-generated/`). Zod schemas live in `packages/types/src/schemas/`. Every package imports types from here.
- **`@shared/env`** — centralized environment parsing/validation with `@t3-oss/env-core`. Shared env contracts for web/queue live here to keep Doppler integration consistent.
- **`@shared/database`** — Prisma client singleton. Contains `schema.prisma` and `prisma.config.ts`. Exports `prisma` instance. Uses `PrismaPg` driver adapter (Prisma 7 requirement).
- **`@shared/rest`** — tRPC router definitions. All API procedures live here (`packages/rest/src/routers/`). Exposes `appRouter`, `createCaller`, and `createTRPCContext`. Uses `ctx.prisma` from typed context.
- **`@shared/tsconfig`** — shared TypeScript configs (`base.json`, `nextjs.json`, `library.json`). Strict settings: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`.

### Dependency Flow

```
apps/* → @shared/rest + @shared/database + @shared/types + @shared/env
@shared/rest → @shared/database (prisma via context) + @shared/types (Zod schemas)
@shared/database → @shared/types/prisma (PrismaClient class)
@shared/env → stands alone (shared env contracts)
@shared/types → stands alone (no internal deps)
```

### Apps

- **`@app/web`** — Next.js 16 web app with tRPC + REST API surface
- **`@app/queue`** — Temporal worker for general workflows (greetings, etc.)
- **`@app/codex`** — Temporal worker for codebase indexing + search pipeline

### Queue Type Consistency

- `apps/queue` must import domain types from `@shared/types` (`packages/types`) and never duplicate model/input types locally.
- `apps/web` and `apps/queue` must share the same type contracts from `@shared/types` so API payloads and workflow payloads stay consistent.
- For any queue workflow/activity input shape that overlaps app/domain data, define or reuse the type in `packages/types` and import it into both apps.

### Queue Rules

- **No create/update/delete on queue.** All DB mutations (CRUD) must go through `apps/web` REST endpoints or tRPC procedures. The queue worker is for background compute and orchestration only (e.g. session enrichment, LLM thread matching).
- When the queue needs to trigger a DB write, it must call a REST endpoint on `apps/web` (via `WEB_APP_URL` env var) instead of importing `@shared/database` directly in activities.
- The Discord bot (runs inside `apps/queue`) ingests messages by calling `POST /api/rest/intake/ingest-from-channel` on the web app.

### Queue Structure

- Keep workflow implementations in `apps/queue/src/workflows/`.
- Keep activity implementations in `apps/queue/src/activities/`.
- Register workflow exports centrally in `apps/queue/src/workflows/index.ts`.
- Register workflow names centrally in `apps/queue/src/workflows/registry.ts`.
- Register activity exports centrally in `apps/queue/src/activities/index.ts`.

### Codex (Codebase Reader) Architecture

`apps/codex` is a Temporal worker that ingests source code, parses it via Tree-sitter AST, generates vector embeddings, and powers hybrid search.

```
apps/codex/src/
  adapters/           # Source adapters (GitHub, GitLab, Bitbucket, Azure DevOps, local git, archive)
  parser/             # Tree-sitter AST parser + per-language queries
  embedder/           # Batch embedding with contextual headers
  workflows/          # Temporal workflows (sync-repo)
  activities/         # Temporal activities (clone, parse, embed, cleanup, list-files, sync-status)
  worker.ts           # Temporal worker entry point
  config.ts           # Env loading from @shared/env/codex
  client.ts           # Manual workflow trigger script
```

**Key constraints:**
- Workflows can't import `@shared/database` (Temporal sandboxing). All DB ops in activities only.
- Search logic lives in `packages/rest/src/routers/codex/` (not in apps/codex) — uses `ctx.prisma`.
- Embedding/tsvector writes use `prisma.$executeRaw` with `::vector` cast.
- `codexEnv` from `@shared/env/codex` provides all Codex-specific env vars.

**Source adapters:** GitHub, GitLab, Bitbucket, Azure DevOps extend `GitAdapter` (shared `simple-git` base). LocalGit also extends `GitAdapter`. Archive downloads and extracts ZIP/tar.gz archives (no git history).

**Codex tRPC procedures** (in `packages/rest/src/routers/codex/router.ts`):
- `codex.repository.*` — CRUD + sync trigger for repositories
- `codex.search` — hybrid search (semantic + keyword + symbol with RRF fusion)
- `codex.chunk.*` — chunk retrieval

**Codex REST endpoints** (in `apps/web/src/app/api/rest/codex/`):
- `/api/rest/codex/repository` — list/create repositories
- `/api/rest/codex/repository/[id]` — get/delete repository
- `/api/rest/codex/repository/[id]/sync` — trigger sync
- `/api/rest/codex/search` — hybrid search
- `/api/rest/codex/chunk/[id]` — get chunk detail
- `/api/rest/codex/repository/[id]/files` — list files

**Codex frontend pages** (in `apps/web/src/app/workspace/[slug]/codex/`):
- `/codex` — dashboard with repo list
- `/codex/repository/new` — add repo form
- `/codex/repository/[id]` — repo detail + sync actions
- `/codex/search` — search interface
- `/codex/chunk/[id]` — chunk viewer

### Support Domain Data Model

Single source of truth for all support/inbox data:

```
Customer (who — one per workspace + source + externalCustomerId)
  └── SupportThread[] (one per issue)
        ├── ThreadMessage[] (flat — visual sub-threads computed client-side)
        ├── ReplyDraft[] (AI drafts, FK to SupportThread)
        └── ThreadAnalysis[] (AI investigation results)

ChannelConnection (channel config: Discord, IN_APP)
WorkspaceAgentConfig (AI agent settings per workspace)
```

- **`SupportThread`** = one issue container. Shown as a page at `/inbox/[threadId]`. One thread = one issue, regardless of how many users report it. Has `clarificationCount` (how many times AI asked for more info) and `lastAnalysisId` (FK to most recent `ThreadAnalysis`).
- **`ThreadMessage`** = all messages (inbound + outbound) in flat list. Visual sub-thread grouping ("Thread 1", "Thread 2") is computed client-side by `groupMessagesIntoSegments()` using `inReplyToExternalMessageId` chains — no DB model for sub-threads.
- **`Customer`** = identity via `(workspaceId, source, externalCustomerId)` unique constraint. No separate CustomerProfile or channel identity tables.
- **`ReplyDraft`** = AI-generated reply draft, FK'd to `SupportThread` + optional `ThreadMessage`. Has `draftType` (RESOLUTION | CLARIFICATION | MANUAL) and optional `analysisId` FK to the `ThreadAnalysis` that produced it.
- **`ThreadAnalysis`** = AI investigation result for a thread. Stores classification (issueCategory, severity, affectedComponent), summary, codexFindings (JSON), sentryFindings (JSON), rcaSummary, sufficiency status, and LLM metadata. One thread can have multiple analyses over time.
- All ingestion paths (Discord bot, Discord webhook, in-app chat webhook) go through `performIngestion()` in the intake router, which upserts `Customer`, matches/creates `SupportThread`, creates `ThreadMessage`, and dispatches the AI analysis pipeline.

### Thread Matching Rules

Thread matching determines which `SupportThread` an incoming message belongs to. The core rule: **same issue = same thread**, even across different users.

**Matching waterfall** (in `packages/rest/src/routers/helpers/thread-matching.ts` + `performIngestion`):

```
1. External thread ID     → 0.99  (Discord thread ID, etc.)
2. Reply chain            → 0.96  (inReplyToExternalMessageId lookup)
3. Time-proximity         → 0.92  (same customer, within recency window)
4. Jaccard fingerprint    → varies (keyword overlap on issueFingerprint)
5. Inline LLM (GPT-4.1)  → varies (semantic match, 5s timeout)
6. New thread             → fallback + async Temporal safety net
```

**Key design decisions:**
- **Candidate query is workspace-wide** — `performIngestion` fetches ALL open threads for the workspace+source (not just the sender's threads). This is how different users reporting the same issue get grouped into one thread.
- **Time-proximity is same-customer only** — rapid-fire messages from the same user within `threadRecencyWindowMinutes` (default 10, configurable on `WorkspaceAgentConfig`) auto-group. Cross-customer matching relies on Jaccard/LLM.
- **Inline LLM fires BEFORE thread creation** — if deterministic matching fails but candidates exist, GPT-4.1 is called synchronously (5s timeout) to attempt semantic matching. Only if the LLM also fails/times out does a new thread get created.
- **Async Temporal workflow is the safety net** — `resolveInboxThreadWorkflow` fires after ingestion for ambiguous cases. It can move messages between threads post-hoc. Do NOT remove this.

**LLM prompt convention:** LLM prompts live in `*.prompt.ts` files (e.g. `thread-match.prompt.ts`). These files contain the system prompt, user message builder, and the API call. Use OpenAI SDK with `gpt-4.1` model. Keep prompts structured with decision frameworks, confidence scales, and few-shot examples.

**Files:**
- `packages/rest/src/routers/helpers/thread-matching.ts` — deterministic matching logic (pure functions, no I/O)
- `packages/rest/src/routers/helpers/thread-match.prompt.ts` — LLM prompt + OpenAI call (shared by inline + queue)
- `packages/rest/src/routers/intake.ts` — `performIngestion()` orchestrates the full flow
- `apps/queue/src/activities/llm-thread-match.activity.ts` — Temporal activity wrapper (imports shared prompt)
- `apps/queue/src/workflows/resolve-inbox-thread.workflow.ts` — async resolution workflow

### AI Analysis Pipeline

After every inbound message, if the workspace has AI enabled (`WorkspaceAgentConfig.enabled + analysisEnabled + autoDraftOnInbound`), the `analyzeThreadWorkflow` Temporal workflow is dispatched. One workflow per thread (idempotent by `analyze-thread-{threadId}`).

**Pipeline flow:**

```
1. Debounce (30s)         → wait for rapid messages to settle
2. Fetch context          → last 20 messages, customer, agent config from DB
3. Sufficiency check      → LLM evaluates if messages have enough context
   ├── INSUFFICIENT       → generate CLARIFICATION draft (ask targeted questions)
   │   └── if clarificationCount >= maxClarifications → escalate thread
   └── SUFFICIENT         → continue to investigation
4. Parallel investigation
   ├── Codex search       → hybrid search (semantic + keyword + symbol) against configured repos
   └── Sentry lookup      → fetch matching errors (MVP: stubbed, returns [])
5. Generate analysis      → LLM produces: issueCategory, severity, component, summary, RCA
6. Generate draft         → LLM writes RESOLUTION reply using analysis + agent tone/prompt
7. Save                   → POST /api/rest/analysis/save creates ThreadAnalysis + ReplyDraft
```

**How sufficiency is assessed:** The sufficiency check is a single LLM call (GPT-4.1) that evaluates ALL messages in the thread against a decision framework: bugs need 2+ of {error message, repro steps, affected feature, environment}; feature requests need what + why; how-to needs a clear question. It does NOT check the codebase first — Codex search only runs after sufficiency passes.

**How Codex search works in the pipeline:** The activity builds a search query from the last 3 message bodies + `issueFingerprint`, calls `POST /api/rest/codex/search` with the workspace's configured `codexRepositoryIds`, and gets back top 5 code chunks (file paths, symbols, content). These are fed into the analysis LLM prompt so it can connect customer symptoms to actual code paths.

**Escalation safety valve:** After `maxClarifications` (default 2) auto-clarifications with no useful response, the thread status is set to `ESCALATED` and no more auto-drafts are generated.

**Key design decisions:**
- **Sufficiency gates investigation** — don't waste Codex/Sentry calls on vague messages. Ask the customer first.
- **Codex search is optional** — only runs if `codexRepositoryIds` is configured on the workspace. Without it, analysis still works (just no code context).
- **Sentry is per-workspace config** — credentials stored on `WorkspaceAgentConfig`, not global env vars.
- **Human-in-the-loop** — all drafts require human approval via `approveDraft`/`dismissDraft`. No auto-send.
- **Queue writes via REST** — `saveAnalysisAndDraftActivity` calls `POST /api/rest/analysis/save` (queue → web pattern).
- **Outbound send is direct (no Temporal)** — `approveDraft` tRPC mutation sends to Discord + records outbound message in one call. Creates Discord threads under customer's first message for synthetic threads, sends into existing threads otherwise.

**Files:**
- `packages/rest/src/routers/helpers/sufficiency-check.prompt.ts` — sufficiency LLM prompt
- `packages/rest/src/routers/helpers/thread-analysis.prompt.ts` — analysis + RCA LLM prompt
- `packages/rest/src/routers/helpers/draft-reply.prompt.ts` — draft reply LLM prompt
- `packages/rest/src/routers/helpers/sentry-client.ts` — Sentry API client (MVP stub)
- `packages/rest/src/routers/agent.ts` — tRPC: `approveDraft` (send to Discord + DB), `dismissDraft`, `getLatestAnalysis`, `triggerAnalysis`, `saveAnalysis`
- `packages/rest/src/temporal.ts` — `dispatchAnalyzeThreadWorkflow()`
- `apps/queue/src/workflows/analyze-thread.workflow.ts` — Temporal workflow orchestration
- `apps/queue/src/activities/analyze-thread.activity.ts` — 8 activity functions
- `apps/web/src/app/api/rest/analysis/save/route.ts` — REST endpoint for queue saves
- `apps/web/src/actions/inbox.ts` — server actions: `approveDraftAction`, `dismissDraftAction`
- `apps/web/src/components/inbox/AnalysisPanel.tsx` — AI Analysis sidebar + DraftChatBubble component
- `apps/web/src/components/inbox/ThreadDetailSheet.tsx` — thread detail with tree layout + draft suggestion area

### Environment Management

- Use `@shared/env` for environment access in `apps/web` and `apps/queue`; avoid direct `process.env` reads in app code.
- Keep env defaults/schemas centralized in `packages/env/src/` so switching to Doppler-injected values requires no app-level refactor.

## Import Convention

Always use the `@shared/` namespace to import from shared packages:

```ts
// Types — models, enums, input types, Zod schemas
import type { User, Post } from "@shared/types";
import { CreateUserSchema } from "@shared/types";

// Database client (direct access in server components)
import { prisma } from "@shared/database";

// tRPC — server-side caller (in server components / RSC)
import { trpc } from "@/trpc/server";
const users = await trpc.user.list();

// tRPC — client-side hooks (in "use client" components)
import { useTRPC } from "@/trpc/client";
import { useQuery } from "@tanstack/react-query";
const trpc = useTRPC();
const { data } = useQuery(trpc.user.list.queryOptions());

// tRPC — router/procedure definitions (in @shared/rest package)
import { createTRPCRouter, publicProcedure } from "@shared/rest";

// Zod validation in API routes
import { CreatePostSchema, type CreatePostInput } from "@shared/types";
```

### Package Entry Points

- `@shared/types` — all model types (`User`, `Post`, etc.), enums, input/output types, and Zod schemas
- `@shared/types/prisma` — the PrismaClient class (used internally by `@shared/database`)
- `@shared/rest` — `appRouter`, `createCaller`, `createTRPCContext`, `createTRPCRouter`, `publicProcedure`
- `@shared/database` — `prisma` singleton instance

### tRPC Architecture

```
packages/rest/src/
  init.ts           → initTRPC, context (injects prisma), publicProcedure
  root.ts           → appRouter (merges all routers), createCaller
  routers/
    user.ts         → user.list, user.create
    post.ts         → post.list, post.create

apps/web/src/
  trpc/
    server.ts       → server-side tRPC caller (uses createCaller, no HTTP)
    client.ts       → client-side tRPC + react-query hooks
    provider.tsx    → QueryClientProvider + TRPCProvider wrapper
  app/api/rest/
    user/route.ts   → GET /api/rest/user, POST /api/rest/user
    post/route.ts   → GET /api/rest/post, POST /api/rest/post
```

**REST endpoints** are clean resource URLs at `/api/rest/*`:
- `GET  /api/rest/user` — list users
- `POST /api/rest/user` — create user (JSON body)
- `GET  /api/rest/post` — list posts
- `POST /api/rest/post` — create post (JSON body)

Each route handler calls tRPC procedures internally via `createCaller` — type-safe, no tRPC URL leaking.

**Server components** use `createCaller` for direct procedure calls (no HTTP overhead).
**Client components** use react-query hooks via `useTRPC` for data fetching with caching.

## Key Prisma 7 Notes

- Generator is `prisma-client` (not `prisma-client-js`)
- `output` field is **required** in the generator block
- DB connection uses driver adapters (`@prisma/adapter-pg`), not `url` in schema
- `prisma.config.ts` handles migration URLs — lives in `packages/database/`
- After changing `schema.prisma`, run `npm run db:generate` to regenerate types into `packages/types`

## Commands

```bash
npm run dev            # start all apps (turbopack)
npm run build          # build everything
npm run build --workspace @app/queue  # build queue worker only
npm run build --workspace @app/codex  # build codex worker only
npm run dev:codex                     # start codex worker (dev mode)
npm run db:generate    # regenerate Prisma types → packages/types/src/prisma-generated/
npm run db:push        # push schema to DB (no migration file)
npm run db:migrate     # create + apply migration
npm run type-check     # typecheck all packages
npm test               # run tests
```

## Troubleshooting: Missing Activities / Types / Schema

If you hit runtime errors like `Activity function X is not registered` or missing types/columns:

1. **Regenerate Prisma types** — `npm run db:generate` (needed after any `.prisma` schema change)
2. **Apply schema to DB** — `npm run db:migrate` (for new migrations) or `npm run db:push` (local prototyping only)
3. **Rebuild the affected app** — `npm run build --workspace @app/queue` (or `@app/web`, `@app/codex`)

The Temporal worker loads **compiled JS**, not source TS. If you add/rename activities or workflows, you **must rebuild** the queue worker before restarting it. Same applies to codex.

**Quick checklist when something is "missing" at runtime:**
- New activity? → Ensure it's exported from `apps/<app>/src/activities/index.ts`, then rebuild.
- New workflow? → Ensure it's exported from `apps/<app>/src/workflows/index.ts`, then rebuild.
- New/changed DB column? → Run `db:generate` + `db:migrate` (or `db:push`), then rebuild.
- New shared type/schema? → Run `db:generate`, then rebuild any consuming app.

**Running `db:push` locally:**
Turbo does not forward env vars to sub-processes, and the `.env` file lives in `apps/web/.env` which Prisma can't find when run from `packages/database/`. Run Prisma directly:

```bash
cd packages/database && DATABASE_URL="postgresql://user:password@localhost:5432/mydb?schema=public" npx prisma db push
```

Add `--accept-data-loss` if prompted about potential data loss on local dev.

## CI Workflows

- `build-web.yml` validates web CI.
- `build-queue.yml` validates queue CI.
- `build-codex.yml` validates codex CI.
- Queue/Codex CI must run `db:generate`, `type-check`, `lint`, and `build --workspace @app/<name>`.

## Adding a New App

1. Create `apps/<name>/` with its own `package.json`
2. Add `@shared/types`, `@shared/database`, and `@shared/rest` as dependencies
3. Extend `@shared/tsconfig/nextjs.json` (for Next.js) or `@shared/tsconfig/library.json` (for services)
4. Add `transpilePackages: ["@shared/types", "@shared/database", "@shared/rest"]` in next.config.ts (if Next.js)
5. Mount tRPC handler at `app/api/trpc/[...trpc]/route.ts`

## Adding a New tRPC Router

1. Create `packages/rest/src/routers/<name>.ts`
2. Define router using `createTRPCRouter` and `publicProcedure`
3. Use `ctx.prisma` for DB access — never import prisma directly in routers
4. Use Zod schemas from `@shared/types` for input validation
5. Register in `packages/rest/src/root.ts` by adding to `appRouter`

## Adding a New Model

1. Add model to `packages/database/prisma/schema.prisma`
2. Run `npm run db:generate` (regenerates types)
3. Add Zod schema in `packages/types/src/schemas/`
4. Run `npm run db:migrate` when ready to apply to DB
5. Import the new type: `import type { NewModel } from "@shared/types"`

## Frontend Rules & Best Practices

### Component Structure

Components go in `src/components/`. Use flat folders per component — colocate styles, tests, and sub-components.

```
src/components/
  UserCard/
    UserCard.tsx        # component
    UserCard.test.tsx   # test
    index.ts            # export barrel
```

### Bad vs Good: Components

```tsx
// BAD: massive component doing everything
export default function Dashboard() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  // ... 200 lines of mixed logic, fetch, filter, render
  return (
    <div>
      <input onChange={e => setSearch(e.target.value)} />
      {users.filter(u => u.name.includes(search)).sort((a,b) => ...).map(user => (
        <div>
          <img src={user.avatar} />
          <span>{user.name}</span>
          <button onClick={() => { /* inline delete logic */ }}>Delete</button>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// GOOD: small, typed, single-responsibility components
interface UserCardProps {
  user: User;
  onDelete: (id: string) => void;
}

function UserCard({ user, onDelete }: UserCardProps) {
  return (
    <div>
      <img src={user.avatar} alt={user.name} />
      <span>{user.name}</span>
      <button onClick={() => onDelete(user.id)}>Delete</button>
    </div>
  );
}
```

### Bad vs Good: Type Safety

```tsx
// BAD: any, untyped props, inline types
function UserList({ data }: any) {
  return data.map((item: any) => <div>{item.whatever}</div>);
}
```

```tsx
// GOOD: import from @shared/types, explicit interfaces
import type { User } from "@shared/types";

interface UserListProps {
  users: User[];
}

function UserList({ users }: UserListProps) {
  return users.map(user => <div key={user.id}>{user.name}</div>);
}
```

### Bad vs Good: Data Fetching (Next.js 16 App Router)

```tsx
// BAD: useEffect fetch in client component
"use client";
export default function UsersPage() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetch("/api/users").then(r => r.json()).then(setUsers);
  }, []);
  return <UserList users={users} />;
}
```

```tsx
// GOOD: server component with tRPC caller (no HTTP overhead)
import { trpc } from "@/trpc/server";

export default async function UsersPage() {
  const users = await trpc.user.list();
  return <UserList users={users} />;
}
```

```tsx
// GOOD: client component with tRPC react-query hooks
"use client";
import { useTRPC } from "@/trpc/client";
import { useQuery } from "@tanstack/react-query";

export function UserList() {
  const trpc = useTRPC();
  const { data: users } = useQuery(trpc.user.list.queryOptions());
  return users?.map(user => <div key={user.id}>{user.name}</div>);
}
```

### Bad vs Good: Form Validation

```tsx
// BAD: manual validation scattered in handler
async function handleSubmit(formData: FormData) {
  const email = formData.get("email") as string;
  if (!email || !email.includes("@")) throw new Error("bad email");
  // ... more manual checks
}
```

```tsx
// GOOD: Zod schema from @shared/types
import { CreateUserSchema } from "@shared/types";

async function handleSubmit(formData: FormData) {
  const parsed = CreateUserSchema.parse({
    email: formData.get("email"),
    name: formData.get("name"),
  });
  await prisma.user.create({ data: parsed });
}
```

### Bad vs Good: "use client" Boundary

```tsx
// BAD: slapping "use client" on the whole page
"use client";
export default function SettingsPage() {
  // entire page is now client-rendered for one toggle
  return (
    <div>
      <h1>Settings</h1>
      <p>Long static content...</p>
      <ThemeToggle />
    </div>
  );
}
```

```tsx
// GOOD: only the interactive part is client
// SettingsPage.tsx (server component — no directive)
export default function SettingsPage() {
  return (
    <div>
      <h1>Settings</h1>
      <p>Long static content...</p>
      <ThemeToggle />  {/* only this is "use client" */}
    </div>
  );
}

// ThemeToggle.tsx
"use client";
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  return <button onClick={() => setDark(!dark)}>Toggle</button>;
}
```

### General Rules

- **No `any`** — use `unknown` and narrow, or import proper types from `@shared/types`
- **No inline types for props** — define an `interface` above the component
- **No barrel exports from `src/`** — import from specific component paths
- **Always add `key` prop** when mapping JSX
- **Prefer server components** — only add `"use client"` when you need hooks, event handlers, or browser APIs
- **Colocate related code** — keep component, hook, and types in the same folder
- **Name files after what they export** — `UserCard.tsx` exports `UserCard`
- **Use `import type`** for type-only imports — keeps bundles clean
- **Validate at the boundary** — use Zod schemas on API routes and form submissions, trust typed internals

## LLM Prompt Files

LLM-powered features use `*.prompt.ts` files that contain the prompt, message builder, and API call in one file.

**Convention:**
- File name: `<feature>.prompt.ts` (e.g. `thread-match.prompt.ts`, `draft-reply.prompt.ts`)
- Location: next to the feature that uses it (e.g. `packages/rest/src/routers/helpers/`)
- Use OpenAI SDK (`openai` package, already in `@shared/rest`) with `gpt-4.1` model
- Export a single async function + options interface
- Structure the system prompt with: task description, decision framework, confidence scale, few-shot examples
- Always include a timeout via `AbortController` (default 5s for inline, 25s for async)
- Parse JSON response with `as` cast — keep it simple, the LLM is instructed to return strict JSON

**Example structure:**
```ts
// feature-name.prompt.ts
const SYSTEM_PROMPT = `...`;
function buildUserMessage(input: Input): string { ... }
export async function featureName(input: Input, options: Options): Promise<Result | null> { ... }
```

## Database Operations

- `DATABASE_URL` — PostgreSQL connection string. Available in `apps/web/.env` for local dev.
- `.env.example` at root for reference
- `db:push` requires `DATABASE_URL` — run: `DATABASE_URL="..." npm run db:push`
- Local dev DB uses pgvector extension — if DB is reset, re-create it: `psql -c "CREATE EXTENSION IF NOT EXISTS vector;"` before pushing schema
- After schema changes, always run `npm run db:generate` first (regenerates Prisma types), then `npm run db:push` (syncs DB)
