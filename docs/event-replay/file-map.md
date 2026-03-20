# Danh sách File & Vai trò

> Tất cả đường dẫn là tương đối từ project root (`/Users/mihi/workground/hehehihihahah/`).

## 1. Browser SDK (`packages/telemetry/`)

| File | Vai trò | Exports chính |
|------|---------|---------------|
| `packages/telemetry/package.json` | Package config. Deps: `rrweb`. Peer: `react`. | — |
| `packages/telemetry/tsconfig.json` | TypeScript config, extends `@shared/tsconfig/base.json` | — |
| `packages/telemetry/src/index.ts` | **Core SDK**. Framework-agnostic. Quản lý toàn bộ lifecycle: init → record → batch → flush → stop. | `Telemetry` (object), `TelemetryConfig` (interface) |
| `packages/telemetry/src/react.tsx` | **React wrapper**. Component `TelemetryProvider` gọi `Telemetry.init()` on mount, `.stop()` on unmount. | `TelemetryProvider` (component) |

### Chi tiết `index.ts` — Telemetry object

```typescript
Telemetry.init(config: TelemetryConfig): void
// Khởi tạo rrweb recording. Gọi 1 lần duy nhất.
// Config bắt buộc: endpoint (string)
// Config tùy chọn: maskAllInputs (default:true), blockSelector, batchSize (50), flushIntervalMs (5000), sampleRate (1.0)

Telemetry.stop(): void
// Dừng recording, clear timer, flush remaining buffer

Telemetry.setUser(user: { id?, email?, username?, ...rest }): void
// Push một event type="user.identify" vào buffer

Telemetry.getSessionId(): string | null
// Trả về sessionId hiện tại
```

### Cách flush hoạt động
1. Buffer events trong mảng `_buffer[]`
2. Khi `_buffer.length >= batchSize` (50) HOẶC mỗi 5s (`flushIntervalMs`) → gọi `flush()`
3. `flush()` dùng raw `fetch` POST tới `{endpoint}/telemetry.ingestEvents`
4. Body format: tRPC batch protocol (`{ "0": { json: { sessionId, events } } }`)
5. Nếu fetch fail → events được `unshift()` lại buffer để retry ở lần flush tiếp
6. `keepalive: true` trên fetch request để đảm bảo gửi được khi tab đang close

---

## 2. tRPC API (`packages/rest/`)

| File | Vai trò |
|------|---------|
| `packages/rest/src/routers/telemetry.ts` | **Telemetry router** — 4 endpoints xử lý ingest và query |
| `packages/rest/src/root.ts` | **Root router** — import và đăng ký `telemetryRouter` |
| `packages/rest/src/init.ts` | tRPC context factory (inject `prisma`) |

### Chi tiết `telemetry.ts` — 4 Endpoints

#### `ingestEvents` (mutation)
- **Input**: `{ sessionId: string, userId?: string, userAgent?: string, events: Array<{type, timestamp, payload, sequence}> }`
- **Validation**: events min 1, max 500; sequence >= 0
- **Logic**: `$transaction([ session.upsert(), replayEvent.createMany() ])`
- **Output**: `{ ingested: number }`

#### `listSessions` (query)
- **Input**: `{ limit?: number (default 20, max 100), cursor?: string }`
- **Logic**: Cursor-based pagination, ordered by `createdAt DESC`, includes `_count.events`
- **Output**: `{ sessions: Session[], nextCursor?: string }`

#### `getSessionReplay` (query)
- **Input**: `{ sessionId: string }`
- **Logic**: `$transaction([session.findUnique(), replayEvent.findMany() ordered by sequence ASC])`
- **Output**: `{ session: Session | null, events: ReplayEvent[] }`

#### `getSessionTimeline` (query)
- **Input**: `{ sessionId: string }`
- **Logic**: `sessionTimeline.findMany() ordered by timestamp ASC`
- **Output**: `SessionTimeline[]`

---

## 3. Database Schema (`packages/database/`)

| File | Vai trò |
|------|---------|
| `packages/database/prisma/schema.prisma` | Prisma schema — chứa 3 models telemetry |
| `packages/database/src/index.ts` | Prisma client singleton export |

### Models (lines 69-110 trong schema.prisma)

Xem chi tiết tại [api-contracts.md](./api-contracts.md).

---

## 4. Temporal Enrichment (`apps/queue/`)

| File | Vai trò |
|------|---------|
| `apps/queue/src/workflows/session-enrichment.workflow.ts` | **Workflow definition** — gọi activity `processSessionEnrichment` |
| `apps/queue/src/activities/session-enrichment.activity.ts` | **Activity implementation** — đọc events, phân tích, tạo timeline entries |
| `apps/queue/src/workflows/index.ts` | Workflow registry export — đăng ký `sessionEnrichmentWorkflow` |
| `apps/queue/src/activities/index.ts` | Activity registry export — đăng ký `processSessionEnrichment` |
| `apps/queue/src/workflows/registry.ts` | Workflow name constants: `sessionEnrichment: "sessionEnrichmentWorkflow"` |

### Chi tiết Activity

```
processSessionEnrichment(sessionId: string): Promise<void>
```

1. Đọc tất cả `ReplayEvent` of session, ordered by `sequence ASC`
2. Tạo `session_summary` (duration, event count)
3. Lọc click events: rrweb `type === 3` (IncrementalSnapshot) + `data.source === 2` (MouseInteraction)
4. Xóa timeline cũ (`deleteMany`) → Insert mới (`createMany`) → **Idempotent**

---

## 5. Next.js Frontend (`apps/web/`)

| File | Vai trò |
|------|---------|
| `apps/web/src/app/layout.tsx` | **Root layout** — wrap app với `<TelemetryProvider endpoint="/api/rest">` |
| `apps/web/src/app/api/rest/[...trpc]/route.ts` | **tRPC catch-all handler** — routes tất cả tRPC requests (bao gồm telemetry) |
| `apps/web/src/app/admin/replays/page.tsx` | **Admin replay page** — UI liệt kê sessions, xem replay, timeline |
| `apps/web/src/components/telemetry/ReplayViewer.tsx` | **Replay player component** — dùng `rrweb-player` để phát lại events |
| `apps/web/src/components/telemetry/TelemetryProvider.tsx` | ⚠️ **DEPRECATED** — file cũ, đã bị thay thế bởi `@shared/telemetry/react`. Có thể xóa. |

### Chi tiết `ReplayViewer.tsx`

- Nhận prop `events: Array<{ type: string; payload: unknown }>`
- Lọc events có `type === "rrweb"` → extract `payload` → truyền cho `rrweb-player`
- Cleanup player instance khi re-render hoặc unmount
- Config: `showController: true`, `autoPlay: false`, `speed: 1`

### Chi tiết Admin Replays Page

- Route: `/admin/replays`
- Sidebar trái: danh sách sessions từ `listSessions` + input search by ID
- Panel phải: `ReplayViewer` + Enriched Timeline + Raw Events (collapsible, max 100)
- Sử dụng tRPC React hooks: `trpc.telemetry.*`

---

## 6. Cấu hình & Dependencies

| File | Liên quan |
|------|-----------|
| `apps/web/package.json` | Dependencies: `@shared/telemetry`, `rrweb`, `rrweb-player` |
| `packages/rest/package.json` | Dependencies: `zod`, `@trpc/server`, `@shared/database` |
| `.env` (root) | `DATABASE_URL` — cần đúng để Prisma connect |
