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
- **`@shared/database`** — Prisma client singleton. Contains Prisma schema files and `prisma.config.ts`. Exports `prisma` instance. Uses `PrismaPg` driver adapter (Prisma 7 requirement).
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

### Queue Type Consistency

- `apps/queue` must import domain types from `@shared/types` (`packages/types`) and never duplicate model/input types locally.
- `apps/web` and `apps/queue` must share the same type contracts from `@shared/types` so API payloads and workflow payloads stay consistent.
- For any queue workflow/activity input shape that overlaps app/domain data, define or reuse the type in `packages/types` and import it into both apps.

### Queue Structure

- Keep workflow implementations in `apps/queue/src/workflows/`.
- Keep activity implementations in `apps/queue/src/activities/`.
- Register workflow exports centrally in `apps/queue/src/workflows/index.ts`.
- Register workflow names centrally in `apps/queue/src/workflows/registry.ts`.
- Register activity exports centrally in `apps/queue/src/activities/index.ts`.

### Environment Management

- Use `@shared/env` for environment access in `apps/web` and `apps/queue`; avoid direct `process.env` reads in app code.
- Keep env defaults/schemas centralized in `packages/env/src/` so switching to Doppler-injected values requires no app-level refactor.

### Prisma Schema Organization (`@shared/database`)

- Split Prisma models/enums into domain files under `packages/database/prisma/` using `*.schema.prisma` naming (examples: `user.schema.prisma`, `workspace.schema.prisma`, `post.schema.prisma`).
- Keep schema definitions organized by domain/entity instead of one large model file.
- Keep `packages/database/prisma/schema.prisma` as the centralized Prisma entrypoint for generator/datasource and schema composition.

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
- If any Prisma schema file changes (`packages/database/prisma/**/*.prisma`), you must create and commit a migration file in `packages/database/prisma/migrations/` using `npm run db:migrate` (do not ship schema-only changes).
- After schema changes + migration creation, run `npm run db:generate` to regenerate types into `packages/types`

## Commands

```bash
npm run dev            # start all apps (turbopack)
npm run build          # build everything
npm run build --workspace @app/queue  # build queue worker only
npm run db:generate    # regenerate Prisma types → packages/types/src/prisma-generated/
npm run db:push        # local prototyping only (do not use for PRs that change schema)
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
- Queue CI must run `db:generate`, `type-check`, `lint`, and `build --workspace @app/queue`.

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

1. Add/update model in the domain Prisma schema file (example: `packages/database/prisma/user.schema.prisma`) and keep `schema.prisma` as the centralized entrypoint
2. Run `npm run db:migrate` and commit the generated migration files
3. Run `npm run db:generate` (regenerates types)
4. Add Zod schema in `packages/types/src/schemas/` for API/input validation
5. Import the new type/schema from `@shared/types`

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
