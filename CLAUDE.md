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

## Environment

- `DATABASE_URL` — PostgreSQL connection string. Set in `packages/database/.env`
- `.env.example` at root for reference
