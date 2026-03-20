# Event Replay System — Agent Reference Documentation

> Tài liệu này được viết dành cho LLM Agent, cung cấp đầy đủ context về tính năng **Event Replay** trong dự án để agent có thể hiểu, sửa lỗi, mở rộng, hoặc tích hợp thêm tính năng mà không cần hỏi lại.

## Mục lục

1. [Tổng quan kiến trúc](./architecture.md) — Sơ đồ luồng dữ liệu, các tầng hệ thống
2. [Danh sách file & vai trò](./file-map.md) — Mọi file liên quan, đường dẫn tuyệt đối, mục đích
3. [API Contract & Data Model](./api-contracts.md) — Database schema, tRPC endpoints, Zod schemas
4. [Hướng dẫn sử dụng & tích hợp](./usage-guide.md) — Cách dùng SDK, cách mở rộng

## Trạng thái hiện tại

- **SDK capture**: ✅ Hoạt động (rrweb ghi lại DOM + interactions)
- **Ingest API**: ✅ Hoạt động (tRPC endpoint nhận batch events)
- **Database**: ✅ Schema đã sync (Session, ReplayEvent, SessionTimeline)
- **Temporal Enrichment**: ✅ Workflow + Activity đã đăng ký
- **Admin UI**: ✅ Trang `/admin/replays` với session list + replay viewer
- **Blocker**: ⚠️ `DATABASE_URL` cần được set đúng trong `.env` root

## Quick Reference

```
packages/telemetry/       ← Browser SDK (@shared/telemetry)
packages/rest/            ← tRPC API (telemetry router)
packages/database/        ← Prisma schema (Session, ReplayEvent, SessionTimeline)
apps/web/                 ← Next.js frontend (admin UI + SDK integration)
apps/queue/               ← Temporal worker (enrichment workflow)
```
