# AI Chatbot — Sổ tiến độ

Cập nhật sau mỗi phase. Phiên bị ngắt: đọc file này → kiểm code thật → làm tiếp phần dang dở, không làm lại phần đã xong.

| Phase | Trạng thái | Bằng chứng |
|:--|:--|:--|
| 1. Phân tích hệ thống + tài liệu API | ✅ xong | `ANALYSIS.md`, `API-INTEGRATION.md`, `reference/pancake-api-research-2026-11-25.md` (OpenAPI chính thức Pancake) |
| 2. Kiến trúc + CSDL + kế hoạch | ✅ xong | `ARCHITECTURE.md`, `DATABASE-DESIGN.md`, `IMPLEMENTATION-PLAN.md` |
| 3. AI Provider + lõi AI | ✅ xong | `lib/ai-chatbot/{providers,classifier,generator,confidence,settings,json,text}.ts` — `tests/ai-chatbot-core.test.cjs` 43/43 |
| 4. Knowledge Base + RAG | ✅ code xong | `retrieval.ts`, `kb-pos.ts`, `kb-sync.ts`, `admin-store.ts` (CRUD + lịch sử + xoá mềm); migration `0009` chạy trên Postgres local |
| 5. Tích hợp Pancake | ✅ code xong (chưa thử Pancake thật — token local hết quyền) | `pancake-parse.ts`, `pancake-client.ts`, `worker.ts` (poller + job), `store-pg.ts` (hàng đợi + khoá thuê) |
| 6. Message Router | ✅ xong | `router.ts` — `tests/ai-chatbot-router.test.cjs` 46/46 (đủ 18 tình huống Phần XII) |
| 7. Telegram + AI Learning | ✅ xong (Telegram chưa thử bot thật) | `telegram.ts`, `learning.ts`, route + tab AI Learning |
| 8. Giao diện quản trị | ✅ xong | 5 tab 🧠 AI Chatbot — build production + xem trên trình duyệt |
| 9. Testing | ✅ xong | lõi 43 · router 46 · bộ chuyển đổi 19 · Postgres thật 18 + test cũ + 211 pytest — TEST-REPORT.md |
| 10. Security audit | ✅ xong | review độc lập: 15 mục, đã sửa hết — FINAL-AUDIT.md |
| 11. Tối ưu + tài liệu | ✅ xong | DEPLOYMENT.md, FINAL-REPORT.md, CHANGELOG.md; CLAUDE.md + DASHBOARD_MAP.md có mục AI Chatbot |

| 12. Page tự động (yêu cầu 26/11) | ✅ xong | migration 0010, `page-policy.ts`, token tự đọc, page lỗi tự nghỉ, né bot khác — test lõi 49 · router 49 · Postgres 19 |

**Việc còn lại là QUYẾT ĐỊNH CỦA USER**: commit / push / deploy; token page Pancake + tag; khoá AI / Telegram; bật staging theo DEPLOYMENT.md §4.

## Quyết định kỹ thuật

* Repo là Next.js + Postgres (không phải Laravel) → module TypeScript `dashboard-ui/src/lib/ai-chatbot/`, migration `0009`.
* Hàng đợi trên Postgres (`FOR UPDATE SKIP LOCKED` + khoá thuê), worker chạy trong tiến trình Next (instrumentation.ts) —
  không thêm Redis / dịch vụ (VPS 1 GB RAM).
* Chỉ Public API chính thức của Pancake + token page (không sinh token mới — vô hiệu token cũ). Không dùng `pancake.vn/api`.
* Mặc định AN TOÀN: AI tắt, không page nào bật, chế độ shadow (không gửi).
* "POS đã xử lý": sổ luật khai trên trang + ân hạn rồi đọc lại hội thoại (dấu `from.is_automated` OFFICIAL) + đọc lại trước khi gửi.

## Bị chặn / giới hạn

* Không có API đọc luật trả lời tự động của Pancake / Botcake (đã soát OpenAPI chính thức) → sổ luật nhập tay.
* Webhook Pancake không có chữ ký → chìa bí mật trên URL + IP nguồn `203.171.22.6`.
* Public API không tạo được tag → hai tag "Bot AI", "Bot AI - Cần hỗ trợ" phải tạo tay trên Pancake.
* Phiên đầu: công cụ WebFetch bị chặn quyền → đã mở quyền (user cho phép "yes hết") và chạy lại nghiên cứu.

## Lỗi gặp phải

* Bộ phân loại dự phòng không mở viết tắt ("ntn") → thêm `normalizeChat()`; câu chào "Chào shop ạ" không nhận → đổi sang tập từ chào.
