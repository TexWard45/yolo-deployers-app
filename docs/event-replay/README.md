# Event Replay System — Agent Reference Documentation

> Tài liệu này được viết dành cho LLM Agent, cung cấp đầy đủ context về tính năng **Event Replay** trong dự án để agent có thể hiểu, sửa lỗi, mở rộng, hoặc tích hợp thêm tính năng mà không cần hỏi lại.

## Mục lục

1. [Tổng quan kiến trúc](./architecture.md) — Sơ đồ luồng dữ liệu, các tầng hệ thống
2. [Danh sách file & vai trò](./file-map.md) — Mọi file liên quan, đường dẫn tuyệt đối, mục đích
3. [API Contract & Data Model](./api-contracts.md) — Database schema, tRPC endpoints, Zod schemas
4. [Hướng dẫn sử dụng & tích hợp](./usage-guide.md) — Cách dùng SDK, cách mở rộng
5. [Error Tracking & Session Investigator](./error-tracking.md) — Error flagging, logError() SDK, getExactErrorMoment API

## Trạng thái hiện tại

- **SDK capture**: ✅ Hoạt động (rrweb + maskAllInputs mặc định)
- **Ingest API**: ✅ REST route gọi tRPC; nhận `traceId` + `route` per event
- **Database**: ✅ Schema sync — Session, ReplayEvent, SessionTimeline, **SessionClick**, **SessionTraceLink**
- **Temporal Enrichment**: ✅ Workflow tự động dispatch sau mỗi ingest (fire-and-forget)
- **Trace Correlation**: ✅ `getSessionByTraceId` endpoint, `SessionTraceLink` model
- **Admin UI**: ✅ Trang `/admin/replays` với session list + replay viewer
- **Demo data**: ✅ Seed script tại `packages/database/prisma/seed.ts`
- **Error Flagging**: ✅ `Session.hasError` + `Session.errorCount`; auto-set on ingest; filter in `listSessions`
- **Error SDK**: ✅ `Telemetry.logError()` + global `window.onerror` / `unhandledrejection` capture in `TelemetryProvider`
- **Error Timeline**: ✅ `SessionTimeline` rows with `type = "ERROR"` — red markers on replay scrubber + auto-seek
- **Error Investigator**: ✅ `getExactErrorMoment` endpoint — sub-second seek by customer identity + time range
- **Pagination**: ✅ `listSessions` uses page-based pagination (`page`, `total`, `totalPages`)

## Quick Reference

```
packages/telemetry/       ← Browser SDK (@shared/telemetry)
packages/rest/            ← tRPC API (telemetry router)
packages/database/        ← Prisma schema (Session, ReplayEvent, SessionTimeline)
apps/web/                 ← Next.js frontend (admin UI + SDK integration)
apps/queue/               ← Temporal worker (enrichment workflow)
```
