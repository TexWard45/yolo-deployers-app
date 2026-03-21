# API Contract & Data Model

## Database Schema (Prisma)

### Model: Session
```prisma
model Session {
  id         String   @id @default(cuid())   // Session ID, also used as client-generated UUID
  userId     String?                          // Optional FK to User
  user       User?    @relation(...)
  userAgent  String?                          // Browser user agent
  ipAddress  String?                          // Client IP (not yet populated)
  hasError   Boolean  @default(false)         // True if any system_error event was ingested
  errorCount Int      @default(0)             // Total error events accumulated across all batches
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  events    ReplayEvent[]
  timelines SessionTimeline[]

  @@index([userId])
}
```

> **Migration:** `20260321120000_add_session_error_flags`
> `hasError` enables O(1) filtering without joining `SessionTimeline`. Updated atomically inside the `ingestEvents` transaction via `errorCount: { increment: N }`.

### Model: ReplayEvent
```prisma
model ReplayEvent {
  id        String   @id @default(cuid())
  sessionId String                           // FK to Session
  session   Session  @relation(..., onDelete: Cascade)
  type      String                           // "rrweb" | "ui.click" | "network.error" | "console.error" etc.
  timestamp DateTime                         // Thời điểm event xảy ra trên client
  payload   Json                             // Raw event data
  sequence  Int                              // Số thứ tự tăng dần trong session
  traceId   String?                          // W3C trace context — dùng để join với backend trace
  route     String?                          // Browser route/path tại thời điểm event

  createdAt DateTime @default(now())

  @@index([sessionId, timestamp])
  @@index([traceId])
}
```

### Model: SessionClick
```prisma
model SessionClick {
  id        String  @id @default(cuid())
  sessionId String
  session   Session @relation(..., onDelete: Cascade)
  selector  String?   // CSS selector của phần tử được click
  tagName   String?   // HTML tag name
  text      String?   // Visible text của phần tử
  x         Float?    // Tọa độ x
  y         Float?    // Tọa độ y
  traceId   String?   // Backend trace liên quan
  route     String?   // Route tại thời điểm click
  timestamp DateTime

  createdAt DateTime @default(now())

  @@index([sessionId, timestamp])
  @@index([traceId])
}
```

### Model: SessionTraceLink
```prisma
model SessionTraceLink {
  id        String   @id @default(cuid())
  sessionId String
  session   Session  @relation(..., onDelete: Cascade)
  traceId   String   // Backend W3C traceId
  timestamp DateTime @default(now())

  @@unique([sessionId, traceId])
  @@index([traceId])
}
```

### Model: SessionTimeline
```prisma
model SessionTimeline {
  id        String   @id @default(cuid())
  sessionId String                           // FK to Session
  session   Session  @relation(..., onDelete: Cascade)
  type      String                           // "session_summary" | "click" | "ERROR"
  content   String                           // Human-readable description / error message
  metadata  Json?                            // Raw rrweb event payload for ERROR rows
  timestamp DateTime                         // Exact moment the event occurred

  createdAt DateTime @default(now())

  @@index([sessionId, timestamp])
}
```

> **`type = "ERROR"` rows** are written automatically by `ingestEvents` when a `system_error` custom event is detected. `content` = error message, `metadata` = full rrweb event payload including `details` passed to `Telemetry.logError()`. These rows are the source for red timeline markers and error timestamps in the replay player.

---

## tRPC Endpoints

### `telemetry.ingestEvents` — Mutation

**Request** (tRPC batch format qua raw fetch):
```json
{
  "0": {
    "json": {
      "sessionId": "0abe7ef9-5df8-45cc-8356-fa13a2e3b441",
      "userId": null,
      "userAgent": "Mozilla/5.0 ...",
      "events": [
        {
          "type": "rrweb",
          "timestamp": "2026-03-14T07:08:40.123Z",
          "payload": {
            "type": 2,
            "data": {
              "node": { "type": 0, "childNodes": [...] },
              "initialOffset": { "left": 0, "top": 0 }
            },
            "timestamp": 1773472120123
          },
          "sequence": 0
        }
      ]
    }
  }
}
```

**Response**:
```json
{ "ingested": 12 }
```

**Response**:
```json
{ "ingested": 12, "sessionId": "0abe7ef9-..." }
```

**Validation (Zod)**:
- `sessionId`: string, min 1 char
- `events`: array, min 1, max 500 items
- Mỗi event: `type` string, `timestamp` coerce date, `payload` record<string, unknown>, `sequence` int >= 0, `traceId?` string, `route?` string

**Side effect**: Sau khi persist thành công, REST route dispatch `sessionEnrichmentWorkflow` tới Temporal (fire-and-forget, không block response).

---

### `telemetry.listSessions` — Query

**Input**:
```ts
{
  page?:          number,   // 1-indexed, default 1
  limit?:         number,   // 1–100, default 20
  customerId?:    string,   // matched via user.identify payload.id
  customerEmail?: string,   // matched via user.identify payload.email
  customerPhone?: string,   // matched via user.identify payload.phone
  startDate?:     Date,
  endDate?:       Date,
  hasError?:      boolean,  // filter to only errored sessions
}
```

**Output**:
```json
{
  "sessions": [
    {
      "id": "clx123...",
      "userId": null,
      "userAgent": "Mozilla/5.0...",
      "hasError": true,
      "errorCount": 3,
      "createdAt": "2026-03-21T10:23:47.000Z",
      "updatedAt": "2026-03-21T10:24:12.000Z",
      "_count": { "events": 94 }
    }
  ],
  "total": 142,
  "page": 1,
  "totalPages": 8
}
```

> **Breaking change from cursor → page-based pagination.** `cursor` and `nextCursor` are removed. Use `page` + `totalPages` for navigation.

---

### `telemetry.getSessionReplay` — Query

**Input**: `{ sessionId: string }`

**Output**:
```json
{
  "session": { "id": "...", "userId": null, ... },
  "events": [
    { "id": "...", "sessionId": "...", "type": "rrweb", "timestamp": "...", "payload": {...}, "sequence": 0 },
    { "id": "...", "sessionId": "...", "type": "rrweb", "timestamp": "...", "payload": {...}, "sequence": 1 }
  ]
}
```

---

### `telemetry.getExactErrorMoment` — Query

Resolves a customer identity to their most recent errored session and returns the sub-second precise video offset to the first error.

**Input**:
```ts
{
  userId?:        string,  // at least one identity field required
  customerEmail?: string,
  customerPhone?: string,
  startTime:      Date,
  endTime:        Date,
}
```

**Output (found)**:
```json
{
  "found": true,
  "sessionId": "clx_xyz123",
  "offsetMs": 47300,
  "errorContent": "Cannot read properties of undefined",
  "errorCount": 3
}
```

**Output (not found)**:
```json
{ "found": false }
```

**Identity resolution:** all three identity fields are looked up via `user.identify` `ReplayEvent` payloads (`payload.id`, `payload.email`, `payload.phone`). `Session.userId` is `null` for SDK-recorded sessions — identity lives in the event stream, not the column. `userId` also performs a secondary direct column match for authenticated flows.

**Time window:** filters on `SessionTimeline.timestamp` (the actual error moment), not `session.createdAt`. Sessions that started before the window but errored inside it are correctly matched.

**`offsetMs` precision:** computed as `errorTimestamp - firstReplayEvent.timestamp`, not `session.createdAt`. This eliminates drift caused by DB write latency and ensures the seek position is anchored to `rrweb-player`'s actual `0:00` mark.

See [error-tracking.md](./error-tracking.md) for full integration guide.

---

### `telemetry.getSessionByTraceId` — Query

**Input**: `{ traceId: string }`

**Output**:
```json
{
  "sessions": [
    { "id": "demo-session-001", "userId": "...", "userAgent": "...", "createdAt": "..." }
  ]
}
```

**Logic**: Tìm sessions qua `SessionTraceLink` table; fallback tìm thêm qua `ReplayEvent.traceId`; dedup kết quả.

---

### `telemetry.getSessionTimeline` — Query

**Input**: `{ sessionId: string }`

**Output**:
```json
[
  {
    "id": "...",
    "sessionId": "...",
    "type": "session_summary",
    "content": "Session lasted 45s with 127 events captured.",
    "metadata": { "eventCount": 127, "durationMs": 45000 },
    "timestamp": "..."
  },
  {
    "id": "...",
    "sessionId": "...",
    "type": "click",
    "content": "Click interaction #1",
    "metadata": { "clickType": 0 },
    "timestamp": "..."
  }
]
```

---

## rrweb Event Types Reference

Payload của mỗi `ReplayEvent` với `type === "rrweb"` là một rrweb `eventWithTime` object:

| rrweb type (number) | Tên | Ý nghĩa |
|---------------------|-----|---------|
| 0 | DomContentLoaded | DOM loaded |
| 1 | Load | Page load |
| 2 | FullSnapshot | Snapshot toàn bộ DOM tree |
| 3 | IncrementalSnapshot | Thay đổi nhỏ (mutation, mouse, input, scroll) |
| 4 | Meta | Metadata (viewport size, href) |
| 5 | Custom | Custom event |

### IncrementalSnapshot sources (trong `payload.data.source`):

| source (number) | Tên | Ý nghĩa |
|------------------|-----|---------|
| 0 | Mutation | DOM node thay đổi |
| 1 | MouseMove | Di chuyển chuột |
| 2 | MouseInteraction | Click, dblclick, contextmenu, etc. |
| 3 | Scroll | Cuộn trang |
| 4 | ViewportResize | Thay đổi kích thước |
| 5 | Input | Nhập liệu (nhưng bị mask nếu `maskAllInputs: true`) |
