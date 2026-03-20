# API Contract & Data Model

## Database Schema (Prisma)

### Model: Session
```prisma
model Session {
  id        String   @id @default(cuid())   // Session ID, also used as client-generated UUID
  userId    String?                          // Optional FK to User
  user      User?    @relation(...)
  userAgent String?                          // Browser user agent
  ipAddress String?                          // Client IP (not yet populated)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events    ReplayEvent[]
  timelines SessionTimeline[]

  @@index([userId])
}
```

### Model: ReplayEvent
```prisma
model ReplayEvent {
  id        String   @id @default(cuid())
  sessionId String                           // FK to Session
  session   Session  @relation(..., onDelete: Cascade)
  type      String                           // "rrweb" | "user.identify" | "ui.click" etc.
  timestamp DateTime                         // Thời điểm event xảy ra trên client
  payload   Json                             // Raw rrweb event data hoặc custom payload
  sequence  Int                              // Số thứ tự tăng dần trong session

  createdAt DateTime @default(now())

  @@index([sessionId, timestamp])
}
```

### Model: SessionTimeline
```prisma
model SessionTimeline {
  id        String   @id @default(cuid())
  sessionId String                           // FK to Session
  session   Session  @relation(..., onDelete: Cascade)
  type      String                           // "session_summary" | "click" | "error_summary"
  content   String                           // Mô tả text human-readable
  metadata  Json?                            // Data bổ sung (eventCount, clickType, etc.)
  timestamp DateTime                         // Thời điểm liên quan

  createdAt DateTime @default(now())

  @@index([sessionId, timestamp])
}
```

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

**Validation (Zod)**:
- `sessionId`: string, min 1 char
- `events`: array, min 1, max 500 items
- Mỗi event: `type` string, `timestamp` coerce date, `payload` record<string, unknown>, `sequence` int >= 0

---

### `telemetry.listSessions` — Query

**Input**: `{ limit?: number (1-100, default 20), cursor?: string }`

**Output**:
```json
{
  "sessions": [
    {
      "id": "clx123...",
      "userId": null,
      "userAgent": "Mozilla/5.0...",
      "ipAddress": null,
      "createdAt": "2026-03-14T07:08:40.000Z",
      "updatedAt": "2026-03-14T07:08:45.000Z",
      "_count": { "events": 47 }
    }
  ],
  "nextCursor": "clx456..."
}
```

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
