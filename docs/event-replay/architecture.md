# Kiến trúc Event Replay

## Sơ đồ luồng dữ liệu

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ @shared/telemetry SDK (packages/telemetry/src/index.ts) │    │
│  │                                                          │    │
│  │  Telemetry.init({ endpoint }) ──► rrweb.record()        │    │
│  │       │                               │                  │    │
│  │       │                      emit(event) → buffer[]      │    │
│  │       │                               │                  │    │
│  │       │              batch full (50) hoặc timer (5s)     │    │
│  │       │                               │                  │    │
│  │       ▼                               ▼                  │    │
│  │  flush() ─── fetch POST ─── /api/rest/telemetry.ingestEvents │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                          HTTP POST
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                      NEXT.JS SERVER                              │
│                                                                  │
│  apps/web/src/app/api/rest/telemetry.ingestEvents/route.ts      │
│       │                                                          │
│       ▼                                                          │
│  trpc.telemetry.ingestEvents()  ← validates + persists           │
│       │                                                          │
│       ├── session.upsert()  ──┐                                  │
│       └── replayEvent.createMany() ──┤  $transaction             │
│                  (traceId + route per event)  │                  │
│                                              ▼                   │
│                              POSTGRESQL                          │
│                (Session, ReplayEvent + traceId/route)            │
│                                                                  │
│  dispatchSessionEnrichment(sessionId)  ← fire-and-forget         │
│  apps/web/src/lib/temporal.ts                                    │
└──────────────────────────────────────────────────────────────────┘
                               │
                    Temporal workflow dispatch
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     TEMPORAL WORKER                               │
│                                                                  │
│  apps/queue/src/workflows/session-enrichment.workflow.ts         │
│       │                                                          │
│       ▼                                                          │
│  apps/queue/src/activities/session-enrichment.activity.ts        │
│       │                                                          │
│       ├── Đọc ReplayEvent theo sessionId                        │
│       ├── Phân tích clicks (rrweb type=3/source=2 + ui.click)   │
│       ├── Tạo session_summary                                   │
│       ├── Bulk insert → SessionTimeline                         │
│       ├── Bulk insert → SessionClick (selector, text, x/y)      │
│       └── Upsert → SessionTraceLink (per traceId tìm thấy)      │
└──────────────────────────────────────────────────────────────────┘
```

## Các tầng hệ thống

### Tầng 1: Capture (Browser SDK)
- **Package**: `@shared/telemetry` (`packages/telemetry/`)
- **Công nghệ**: `rrweb` (DOM snapshot + mutation observer)
- **Giao thức**: Raw `fetch` POST (tRPC batch format)
- **Không phụ thuộc**: tRPC client, React, Next.js — chạy ở bất kỳ đâu

### Tầng 2: Transport (Next.js API Route)
- **File**: `apps/web/src/app/api/rest/[...trpc]/route.ts`
- **Chức năng**: Catch-all tRPC handler, chuyển tiếp request tới `appRouter`
- **Mapping**: `POST /api/rest/telemetry.ingestEvents` → `telemetryRouter.ingestEvents`

### Tầng 3: Ingest & Storage (tRPC Router)
- **File**: `packages/rest/src/routers/telemetry.ts`
- **4 endpoints**: `ingestEvents`, `listSessions`, `getSessionReplay`, `getSessionTimeline`
- **Atomic**: Sử dụng `$transaction` cho upsert session + createMany events

### Tầng 4: Storage (PostgreSQL + Prisma)
- **Files**: `packages/database/prisma/telemetry.schema.prisma`
- **5 models**: `Session`, `ReplayEvent`, `SessionTimeline`, `SessionClick`, `SessionTraceLink`
- **Index**: `[sessionId, timestamp]` trên ReplayEvent/SessionTimeline/SessionClick; `[traceId]` trên ReplayEvent/SessionClick/SessionTraceLink

### Tầng 5: Enrichment (Temporal)
- **Workflow**: `apps/queue/src/workflows/session-enrichment.workflow.ts`
- **Activity**: `apps/queue/src/activities/session-enrichment.activity.ts`
- **Dispatch**: Tự động trigger từ `apps/web/src/lib/temporal.ts` sau mỗi ingest thành công
- **Idempotent dispatch**: `workflowId = session-enrichment-{sessionId}` — nếu workflow đã chạy, `WorkflowExecutionAlreadyStartedError` được bỏ qua (browser SDK gửi nhiều batch cho cùng một session)
- **Tính năng**: Tạo SessionTimeline + SessionClick + SessionTraceLink — idempotent (deleteMany + createMany trong transaction)

### Tầng 6: Visualization (Admin UI)
- **Page**: `apps/web/src/app/admin/replays/page.tsx` (route: `/admin/replays`)
- **Component**: `apps/web/src/components/telemetry/ReplayViewer.tsx` (rrweb-player)
- **Data**: Sử dụng tRPC hooks (`trpc.telemetry.listSessions`, `.getSessionReplay`, `.getSessionTimeline`)
