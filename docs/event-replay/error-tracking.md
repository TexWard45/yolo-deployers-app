# Error Tracking & Session Investigator

This document covers the error flagging system, the `logError()` SDK method, the `getExactErrorMoment` tRPC endpoint, and the Error Investigator panel in the admin UI.

---

## Overview

The system automatically detects and flags JavaScript errors that occur during a user session. When an error is logged, three things happen in a single DB transaction:

1. `Session.hasError` is set to `true` and `Session.errorCount` is incremented
2. A `SessionTimeline` row with `type = "ERROR"` is created, storing the exact timestamp and error message
3. The raw rrweb event is stored in `ReplayEvent` as usual so the full recording is preserved

The admin replay player then uses the `SessionTimeline` timestamps to:
- Display red markers on the video scrubber at the exact error moments
- Auto-seek to 3 seconds before the first error when a session is opened

---

## Architecture

```
Browser (SDK)
  Telemetry.logError("msg", details)
    └─ rrweb.addCustomEvent("system_error", { message, ...details })
         └─ emitted through rrweb's record() emit callback
              └─ buffered as { type: "rrweb", payload: { type: 5, data: { tag: "system_error" } } }
                   └─ flushed to POST /api/rest/telemetry.ingestEvents

Backend (ingestEvents mutation)
  └─ detects payload.type === 5 && payload.data.tag === "system_error"
       └─ $transaction [
            session.upsert({ hasError: true, errorCount: { increment: N } }),
            replayEvent.createMany(...),
            sessionTimeline.createMany({ type: "ERROR", timestamp, content })
          ]

Admin UI
  └─ listSessions filter: hasError = true → shows red badge with count
  └─ getSessionTimeline → errorTimestamps → red markers on scrubber + auto-seek
  └─ getExactErrorMoment → sessionId + offsetMs → auto-select session + precise seek
```

---

## 1. SDK: Logging Errors

### Automatic capture (via `TelemetryProvider`)

`TelemetryProvider` registers global error listeners on mount. Any unhandled error or rejected promise is automatically captured — no manual calls needed.

```tsx
// app/layout.tsx — already wired, nothing extra needed
import { TelemetryProvider } from "@shared/telemetry/react";

export default function RootLayout({ children }) {
  return (
    <TelemetryProvider endpoint="/api/rest">
      {children}
    </TelemetryProvider>
  );
}
```

Internally, `TelemetryProvider` registers:
```ts
window.addEventListener("error", (e) =>
  Telemetry.logError(e.message, { filename: e.filename, lineno: e.lineno, colno: e.colno })
);
window.addEventListener("unhandledrejection", (e) =>
  Telemetry.logError(e.reason?.message ?? "Unhandled Promise Rejection")
);
```

### Manual capture

Call `Telemetry.logError()` anywhere you catch an error and want it indexed with full metadata:

```ts
import { Telemetry } from "@shared/telemetry";

try {
  doSomethingRisky();
} catch (err: any) {
  Telemetry.logError(err.message, {
    source: "checkout.applyDiscount",
    couponCode,
    userId: currentUser.id,
  });
}
```

**Signature:**
```ts
Telemetry.logError(errorMsg: string, details?: Record<string, unknown>): void
```

- No-op if the SDK is not initialized or recording has stopped
- `details` is stored as metadata on the `SessionTimeline` row and is visible in the Timeline tab

### How it works under the hood

`logError` calls `rrweb.addCustomEvent("system_error", payload)`. This produces a standard rrweb Custom Event (type `5`) in the recording stream:

```json
{
  "type": 5,
  "timestamp": 1711234567890,
  "data": {
    "tag": "system_error",
    "payload": {
      "message": "Cannot read properties of undefined",
      "source": "checkout.applyDiscount"
    }
  }
}
```

The backend detects these on ingestion:
```ts
const isErrorEvent = (e) =>
  e.type === "rrweb" &&
  e.payload?.type === 5 &&
  e.payload?.data?.tag === "system_error";
```

---

## 2. Database Schema Changes

Two fields added to the `Session` model (migration: `20260321120000_add_session_error_flags`):

```prisma
model Session {
  // ... existing fields
  hasError   Boolean  @default(false)  // Quick flag for O(1) error filtering
  errorCount Int      @default(0)      // Total error events across all ingestion batches
}
```

`SessionTimeline` rows with `type = "ERROR"` store the precise per-error data:

```prisma
// Example row produced by logError()
{
  sessionId: "clx...",
  type:      "ERROR",
  content:   "Cannot read properties of undefined",   // error message
  metadata:  { type: 5, data: { tag: "system_error", payload: { source: "..." } } },
  timestamp: "2026-03-21T10:23:47.312Z"               // exact moment the error occurred
}
```

---

## 3. tRPC API Changes

### `telemetry.listSessions` — updated

**New filter:** `hasError?: boolean`

```ts
// Fetch only sessions that contain errors
const { data } = trpc.telemetry.listSessions.useQuery({
  page: 1,
  limit: 20,
  hasError: true,
});
```

**New pagination model** (breaking change from cursor → page-based):

| Old field | New field | Notes |
|-----------|-----------|-------|
| `cursor?: string` | `page: number` (default 1) | offset-based, 1-indexed |
| returns `nextCursor` | returns `total`, `totalPages`, `page` | |

**Output:**
```json
{
  "sessions": [...],
  "total": 142,
  "page": 1,
  "totalPages": 8
}
```

Sessions now include `hasError` and `errorCount` fields:
```json
{
  "id": "clx123...",
  "hasError": true,
  "errorCount": 3,
  "_count": { "events": 94 }
}
```

---

### `telemetry.getExactErrorMoment` — new endpoint

Resolves a customer identity to their most recent errored session and returns the **sub-second precise** video offset to the first error moment.

**Endpoint:** `trpc.telemetry.getExactErrorMoment.useQuery(...)`
**Access:** `protectedProcedure` (requires authentication)

#### Input

```ts
{
  userId?:        string,   // system user ID
  customerEmail?: string,   // resolved via user.identify event payloads
  customerPhone?: string,   // resolved via user.identify event payloads
  startTime:      Date,     // search window start
  endTime:        Date,     // search window end
}
```

At least one identity field (`userId`, `customerEmail`, or `customerPhone`) is required. Validation enforced by Zod `.refine()`.

#### Identity resolution

All three identity fields are resolved via `user.identify` `ReplayEvent` payloads — **not** via `Session.userId` directly. This is because the SDK never writes `userId` to the `Session` row on creation; the identity only exists in the `user.identify` event emitted by `Telemetry.setUser()`.

| Field | Payload path searched |
|-------|-----------------------|
| `userId` | `user.identify` → `payload.id` + `Session.userId` direct fallback |
| `customerEmail` | `user.identify` → `payload.email` |
| `customerPhone` | `user.identify` → `payload.phone` |

`userId` also performs a secondary direct match on `Session.userId` (for authenticated flows where the column is populated), with results merged and deduplicated.

#### Time window filtering

The time window (`startTime`/`endTime`) is checked against `SessionTimeline.timestamp` — the **actual moment the error occurred** — not `Session.createdAt`. This ensures sessions that started before the window but produced an error inside it are correctly found.

#### Output

**Found:**
```json
{
  "found": true,
  "sessionId": "clx_xyz123",
  "offsetMs": 47300,
  "errorContent": "Cannot read properties of undefined",
  "errorCount": 3
}
```

**Not found:**
```json
{
  "found": false
}
```

#### Sub-second accuracy: why `offsetMs` is precise

A common mistake is computing the seek offset as:
```
offsetMs = errorTimestamp - session.createdAt
```

This is **wrong**. `session.createdAt` is the database write time, which can be hundreds of milliseconds after the rrweb recording actually started. The rrweb player's `0:00` mark is bound to the timestamp of the **first `ReplayEvent`**, not the session creation time.

This endpoint avoids the drift by fetching the first `ReplayEvent`:
```ts
// Inside getExactErrorMoment
const firstEventTime = session.events[0]?.timestamp.getTime()
                    ?? session.createdAt.getTime(); // fallback only

const offsetMs = Math.max(0, errorTimestamp - firstEventTime);
```

`offsetMs` is therefore already anchored to `rrweb-player`'s internal timeline. The frontend only needs to subtract 3 seconds for context and call `goto()`.

#### Frontend integration

```tsx
// 1. Query the endpoint
const { data: result, isFetching } = trpc.telemetry.getExactErrorMoment.useQuery(
  {
    customerPhone: "+84912345678",
    startTime: new Date("2026-03-20T00:00:00Z"),
    endTime:   new Date("2026-03-21T00:00:00Z"),
  },
  { enabled: false } // trigger manually with refetch()
);

// 2. When found, auto-select the session and pass the offset
if (result?.found) {
  setSelectedSessionId(result.sessionId);
  setInitialOffsetMs(result.offsetMs);
}

// 3. Pass to ReplayViewer
<ReplayViewer
  events={replayData.events}
  initialOffsetMs={initialOffsetMs}
/>
```

---

## 4. `ReplayViewer` Component

**File:** `apps/web/src/components/telemetry/ReplayViewer.tsx`

### Props

```ts
interface ReplayViewerProps {
  events: Array<{ type: string | number; payload: unknown }>;

  // Absolute Unix timestamps (ms) from SessionTimeline ERROR rows.
  // Used for red scrubber markers and default auto-seek.
  errorTimestamps?: number[];

  // Backend-computed offset (ms from first rrweb event).
  // When provided, takes priority over errorTimestamps for seek position.
  // Source: telemetry.getExactErrorMoment → offsetMs
  initialOffsetMs?: number;
}
```

### Seek priority

```
initialOffsetMs provided?
  YES → goto(max(0, initialOffsetMs - 3000), true)   ← sub-second accurate
  NO  → errorTimestamps[0] present?
          YES → goto(max(0, errorTimestamps[0] - firstEvent.timestamp - 3000), true)
          NO  → no auto-seek, player starts at 0:00
```

### Timeline markers

When `errorTimestamps` is provided, red dot markers are rendered on the scrubber at each error moment via `rrweb-player`'s `tags` prop:

```ts
tags: { "Error": errorTimestamps }  // absolute Unix ms timestamps
```

---

## 5. Admin UI: `/admin/replays`

### Error filter

A checkbox in the filter panel filters the session list to only errored sessions:

```
[x] Errors only   ← triggers listSessions({ hasError: true })
```

Sessions with errors display a red badge: `🛡 3` (shield icon + error count).

### Pagination

The session list uses page-based pagination with a compact page number bar:

```
‹  1  2  …  5  6  7  …  23  ›
```

- Prev `‹` / Next `›` buttons disabled at boundaries
- Page resets to 1 on any filter change
- Total session count shown in the page header

### Error Investigator panel

Collapsed amber bar at the top of the page. Expand to search by customer identity + time range:

| Field | Description |
|-------|-------------|
| User ID | System user ID, matched via `Session.userId` |
| Email | Matched via `user.identify` event payload |
| Phone | Matched via `user.identify` event payload |
| Start / End | `datetime-local` inputs for the search window (defaults to last 24h if empty) |

On "Find Error Moment":
1. `getExactErrorMoment` is queried
2. If `found: true` — the session is auto-selected in the list, the player opens and jumps to `offsetMs - 3s`
3. Result shows: `Error at +47.3s — Cannot read properties of undefined (3 total errors)`
4. If `found: false` — "No match" badge with explanation

---

## 6. Ops Workflow: Investigating a Customer Error

```
CS ticket: "User +84912345678 reported checkout crash at ~10am today"
  ↓
Open /admin/replays → expand Error Investigator
  ↓
Enter phone: +84912345678
Set start: 2026-03-21 09:30, end: 2026-03-21 10:30
Click "Find Error Moment"
  ↓
Result: "Error at +47.3s — Cannot read properties of undefined"
  ↓
Player auto-opens at the session and seeks to 44.3s (3s before crash)
  ↓
Watch cursor movements → identify the exact coupon code the user typed
  ↓
Share sessionId + offsetMs with dev team for root cause analysis
```

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `logError()` call has no effect | SDK not initialized (recording not started) | Ensure `TelemetryProvider` wraps the component tree; check `Telemetry.getSessionId()` returns non-null |
| Error events ingested but `hasError` stays `false` | Custom event tag mismatch | Confirm rrweb payload has `data.tag === "system_error"` (check Network tab for the ingest request body) |
| `getExactErrorMoment` returns `found: false` | Session outside the time window, or wrong identity field | Verify the customer has an active session in the window; check `user.identify` was called with the matching field |
| Player seeks to wrong position | `initialOffsetMs` calculated against `session.createdAt` instead of first event | This endpoint uses first `ReplayEvent.timestamp` — verify you're using the `offsetMs` field from the response, not computing it yourself |
| Red markers missing on scrubber | `errorTimestamps` not passed to `ReplayViewer` | The hook derives `errorTimestamps` from `getSessionTimeline` — check that timeline rows with `type = "ERROR"` exist for the session |
