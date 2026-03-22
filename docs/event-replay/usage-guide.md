# Hướng dẫn Sử dụng & Tích hợp

## 1. Tích hợp SDK vào ứng dụng

### Cách 1: React / Next.js (Khuyến nghị)

```tsx
// app/layout.tsx hoặc bất kỳ root component nào
import { TelemetryProvider } from "@shared/telemetry/react";

export default function RootLayout({ children }) {
  return (
    <TelemetryProvider endpoint="/api/rest">
      {children}
    </TelemetryProvider>
  );
}
```

### Cách 2: Vanilla JavaScript / Vue / Svelte / bất kỳ

```typescript
import { Telemetry } from "@shared/telemetry";

// Gọi 1 lần khi app khởi động
Telemetry.init({ endpoint: "/api/rest" });

// Tùy chọn: identify user sau khi login
Telemetry.setUser({ email: "user@example.com", id: "user_123" });

// Khi app unmount (SPA navigation away)
Telemetry.stop();
```

### Cách 3: HTML Script Tag (chưa triển khai)

Nếu cần, có thể build SDK thành UMD bundle và dùng như Decipher:
```html
<script src="/telemetry.umd.js"></script>
<script>
  Telemetry.init({ endpoint: "/api/rest" });
</script>
```

---

## 2. Cấu hình SDK

```typescript
Telemetry.init({
  // Bắt buộc
  endpoint: "/api/rest",          // Base URL của tRPC API

  // Tùy chọn (defaults)
  maskAllInputs: true,            // Ẩn nội dung input (password, credit card)
  blockSelector: "[data-telemetry-block]",  // CSS selector để block elements khỏi recording
  batchSize: 50,                  // Số events tối đa mỗi batch
  flushIntervalMs: 5000,          // Flush mỗi 5 giây
  sampleRate: 1.0,                // 1.0 = 100% sessions, 0.5 = 50% sessions
});
```

### Privacy: Block elements cụ thể

```html
<!-- Element này sẽ KHÔNG bị record -->
<div data-telemetry-block>
  <p>Nội dung nhạy cảm</p>
</div>
```

---

## 3. Xem Replay

### Qua Admin UI
1. Truy cập `/admin/replays`
2. Sidebar trái hiển thị danh sách sessions gần nhất
3. Click vào session → panel phải hiển thị:
   - **Replay video** (rrweb-player) — phát lại mọi thao tác
   - **Enriched Timeline** — click summary, session duration
   - **Raw Events** — collapsible, hiển thị 100 events đầu

### Qua API trực tiếp
```typescript
// Server-side (tRPC caller)
const sessions = await trpc.telemetry.listSessions({ limit: 10 });
const replay = await trpc.telemetry.getSessionReplay({ sessionId: "..." });
const timeline = await trpc.telemetry.getSessionTimeline({ sessionId: "..." });
```

---

## 4. Mở rộng tính năng

### Thêm event type mới

Trong SDK (`packages/telemetry/src/index.ts`), thêm method mới:

```typescript
// Ví dụ: track page navigation
Telemetry.trackPageView(url: string) {
  if (_sessionId && _config) {
    _buffer.push({
      type: "page.view",
      timestamp: new Date(),
      payload: { url, referrer: document.referrer },
      sequence: _sequence++,
    });
  }
}
```

### Thêm enrichment logic

Trong activity (`apps/queue/src/activities/session-enrichment.activity.ts`):

```typescript
// Ví dụ: detect error events
const errors = events.filter(e => e.type === "console.error");
for (const error of errors) {
  timelineEntries.push({
    sessionId,
    type: "error",
    content: `Console error: ${(error.payload as any).message}`,
    metadata: error.payload as Prisma.InputJsonValue,
    timestamp: error.timestamp,
  });
}
```

### Thêm tRPC endpoint mới

Trong router (`packages/rest/src/routers/telemetry.ts`):

```typescript
getSessionsByUser: publicProcedure
  .input(z.object({ userId: z.string() }))
  .query(({ ctx, input }) => {
    return ctx.prisma.session.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }),
```

---

## 5. Trigger Enrichment Workflow

Hiện tại, enrichment workflow KHÔNG tự động trigger từ ingest API (đã tách ra khỏi hot path). Để trigger:

### Cách 1: Manual qua Temporal CLI
```bash
temporal workflow start \
  --type sessionEnrichmentWorkflow \
  --task-queue resolveai-support-queue \
  --input '"SESSION_ID_HERE"'
```

### Cách 2: Programmatic qua Temporal Client
```typescript
import { Client, Connection } from "@temporalio/client";

const connection = await Connection.connect({ address: "localhost:7233" });
const client = new Client({ connection });

await client.workflow.start("sessionEnrichmentWorkflow", {
  args: [sessionId],
  taskQueue: "resolveai-support-queue",
  workflowId: `enrichment-${sessionId}`,
});
```

### Cách 3: Tạo cron job / scheduled workflow
Thêm vào `apps/queue/` một cron-style workflow chạy enrichment cho tất cả sessions chưa enriched.

---

## 6. Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Network tab: 404 trên `telemetry.ingestEvents` | Thiếu catch-all tRPC handler | Kiểm tra `apps/web/src/app/api/rest/[...trpc]/route.ts` tồn tại |
| Network tab: 500 SASL error | `DATABASE_URL` không có hoặc sai password | Set `DATABASE_URL` trong `.env` root |
| rrweb không ghi lại | SDK chưa được init / đã bị stop | Kiểm tra `TelemetryProvider` có trong layout tree |
| Replay player trắng | Events chưa có trong DB hoặc không có type "rrweb" | Kiểm tra DB bằng `prisma studio` |
| Admin page redirect /login | Route bị protect bởi auth middleware | Cần login hoặc tạm tắt middleware cho `/admin/replays` |
