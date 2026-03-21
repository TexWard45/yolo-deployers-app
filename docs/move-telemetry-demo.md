# Engineering Spec: Move Telemetry Demo Pages to Separate Repo

## 1. Job to Be Done

- **Who:** Developer maintaining this monorepo.
- **What:** Move the demo/test pages that exercise the telemetry SDK into a standalone repo. The telemetry system itself (SDK, backend, DB, admin viewer) stays in this repo untouched.
- **Why:** The demo pages are only used to test/showcase the telemetry feature and don't belong in the production app. A separate repo keeps the demo independent without cluttering the main codebase.
- **Success criteria:** Demo pages run in the new repo, pointing at the existing backend's ingest endpoint. This repo builds cleanly after the demo pages are removed.

---

## 2. What Stays in This Repo (DO NOT move)

Everything below is the production telemetry system and must remain:

- `packages/telemetry/` — SDK package (`TelemetryClient`, `TelemetryProvider`)
- `packages/rest/src/routers/telemetry.ts` — tRPC router (ingest, list, replay, timeline, etc.)
- `apps/web/src/app/api/rest/telemetry.ingestEvents/route.ts` — ingest REST endpoint
- `apps/web/src/app/admin/replays/page.tsx` — admin replay viewer
- `apps/web/src/components/telemetry/ReplayViewer.tsx` — rrweb-player component
- `apps/web/src/hooks/useReplayExplorer.ts` — replay explorer hook
- `packages/database/prisma/telemetry.schema.prisma` — all DB models (Session, ReplayEvent, etc.)
- `apps/queue/src/workflows/session-enrichment.workflow.ts` + activity — enrichment pipeline
- `apps/web/src/app/layout.tsx` — `TelemetryProvider` wrapper stays (records real user sessions)
- `packages/rest/src/root.ts` — `telemetryRouter` registration stays
- `docs/event-replay/` — documentation stays

---

## 3. Files to Move

### 3.1 Demo Pages

| File | Purpose |
|------|---------|
| `apps/web/src/app/test-telemetry/page.tsx` | Simple SDK test — click counter, form inputs, privacy blocker, stop/flush button |
| `apps/web/src/app/app/customer-demo/page.tsx` | Full customer journey demo — fake e-commerce with intentional bugs (crash, flicker, freeze), cart, coupon codes |

### 3.2 Debug Route (optional — only useful for demo/debugging)

| File | Purpose |
|------|---------|
| `apps/web/src/app/api/debug-replay/route.ts` | `GET` debug endpoint — lists sessions or dumps first 5 events. Not used by production features. |

---

## 4. Setup Required for the New Repo

### 4.1 Architecture

The demo app is a simple Next.js app that:
1. Includes the `@shared/telemetry` SDK (copy or publish as npm package)
2. Points the SDK's `endpoint` at the **existing** backend's ingest URL (e.g. `https://your-app.com/api/rest`)
3. Hosts the demo pages locally

No database, no tRPC, no Prisma needed in the demo repo — it's a pure frontend app that sends events to the existing backend.

### 4.2 npm Dependencies

| Package | Purpose |
|---------|---------|
| `next` | Framework |
| `react`, `react-dom` | UI |
| `rrweb@2.0.0-alpha.20` | Session recording (transitive via SDK) |
| `lucide-react` | Icons (used by customer-demo page) |
| shadcn/ui: `Button`, `Input`, `Card`, `Badge`, `Tabs` | UI components (used by both demo pages) |

### 4.3 Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_TELEMETRY_ENDPOINT` | The ingest endpoint URL, e.g. `https://your-app.com/api/rest` |

### 4.4 What to Adapt in Moved Files

**Both demo pages** import from `@shared/telemetry` and shadcn components:
- `import { Telemetry } from "@shared/telemetry"` — either copy the SDK into the new repo as a local package, or change the import to point at a published package
- `import { Button } from "@/components/ui/button"` etc. — copy the required shadcn components
- `import { cn } from "@/lib/utils"` — copy the `cn` utility

**`customer-demo/page.tsx`** has no backend calls — it's entirely client-side state + SDK calls. No tRPC dependency.

**`test-telemetry/page.tsx`** has a `<Link href="/admin/replays">` — update this to point at the main app's admin URL or remove it.

**`debug-replay/route.ts`** imports `prisma` from `@shared/database` and `getSession` from auth — if you move this, it needs its own DB connection, or just drop it (it's a throwaway debug tool).

### 4.5 Suggested Repo Structure

```
src/
  app/
    layout.tsx              # TelemetryProvider wrapping children
    test-telemetry/page.tsx
    customer-demo/page.tsx
  components/ui/            # shadcn components (Button, Input, Card, Badge, Tabs)
  lib/
    utils.ts                # cn() utility
    telemetry/              # copy of SDK (index.ts + react.tsx) or npm dependency
```

### 4.6 TelemetryProvider Config

In the demo repo's `layout.tsx`, configure the SDK to point at the remote backend:

```tsx
<TelemetryProvider endpoint={process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ?? "/api/rest"}>
  {children}
</TelemetryProvider>
```

### 4.7 CORS

The existing ingest endpoint (`telemetry.ingestEvents/route.ts`) already has CORS headers. In production it uses `NEXT_PUBLIC_APP_URL` as the allowed origin. You'll need to either:
- Add the demo app's domain to the allowed origins, or
- Set `NEXT_PUBLIC_APP_URL` to `*` for dev/testing

---

## 5. Task Checklist

### New Repo Setup
- [ ] Create new Next.js 16 app
- [ ] Copy or install the telemetry SDK (`packages/telemetry/src/index.ts` + `react.tsx`)
- [ ] Copy shadcn/ui components used by demo pages (`Button`, `Input`, `Card`, `Badge`, `Tabs`)
- [ ] Copy `cn()` utility

### Move Pages
- [ ] Copy `test-telemetry/page.tsx` — update `@shared/telemetry` import path, remove `/admin/replays` link or update to external URL
- [ ] Copy `customer-demo/page.tsx` — update `@shared/telemetry` import path
- [ ] (Optional) Copy `debug-replay/route.ts` — requires its own Prisma setup, or skip it

### Wiring
- [ ] Add `TelemetryProvider` to demo app's root layout with configurable endpoint
- [ ] Add `NEXT_PUBLIC_TELEMETRY_ENDPOINT` env var
- [ ] Verify CORS: ensure the main app's ingest endpoint allows the demo app's origin

### Cleanup (in this repo)
- [ ] Delete `apps/web/src/app/test-telemetry/` directory
- [ ] Delete `apps/web/src/app/app/customer-demo/` directory
- [ ] (Optional) Delete `apps/web/src/app/api/debug-replay/` directory
- [ ] Verify `npm run build` still passes

---

## 6. Testing Checklist

### New Repo
- [ ] Demo app starts with `npm run dev`
- [ ] `/test-telemetry` — clicking, typing, stop/flush all work; events reach the backend
- [ ] `/customer-demo` — identify, add to cart, apply coupon (SAVE10, HALF, CRASH), trigger flicker, trigger freeze all work
- [ ] Session appears in the main app's `/admin/replays` with recorded events
- [ ] Error events from CRASH/freeze show up with `hasError=true` in admin
- [ ] `npm run build` succeeds in demo repo

### This Repo (after cleanup)
- [ ] `npm run build` passes
- [ ] `npm run type-check` passes
- [ ] Telemetry SDK still records on production pages (TelemetryProvider in layout untouched)
- [ ] `/admin/replays` still works
- [ ] Ingest endpoint still accepts events
