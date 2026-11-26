# AI Chatbot — Thiết kế CSDL (migration `db/migrations/0009_ai_chatbot.sql`)

Nguyên tắc: **chỉ thêm bảng mới** (tiền tố `ai_`), không sửa / xoá cột bảng cũ. Đọc (không ghi) bảng cũ: `pancake_pages`
(tên page, nước, biến khoá token tài khoản), `inbox_assignments` (Sale đã được gán trên dashboard), `api_credentials`
(khoá mã hoá — ghi qua `saveCredential()` sẵn có). Mọi bảng `ai_*` nằm trong `PRIVATE_TABLES` (`sync/core/pg_view.py`) +
`REVOKE` cuối migration → hai vai chỉ đọc (`/api/query`, "Hỏi AI") không đọc được.

## Bảng

| Bảng | Vai trò | Khoá / chống trùng | Ghi bởi |
|:--|:--|:--|:--|
| `ai_bot_settings` | Phần sửa cài đặt (jsonb) phủ lên `talpha_rules.json → ai_chatbot` | 1 dòng (`id = 1`) | Cài đặt AI |
| `ai_bot_pages` | Page bật AI, mốc quét (`poll_cursor`), lỗi quét gần nhất | PK `page_id` | Cài đặt AI, worker |
| `ai_kb_entries` | Knowledge Base. `scope` global / market / page; `kind`; `source` pos_sync / admin / learning; `is_official`; `metadata` (biến thể: giá, tồn kho, tiền tệ, băm nội dung); `synced_at`; `valid_until`; `deleted_at` (xoá mềm) | UNIQUE một phần `source_ref` (đồng bộ POS upsert) | Kiến thức, đồng bộ POS, duyệt Learning |
| `ai_kb_revisions` | Lịch sử: create / update / enable / disable / delete / sync (before, after, actor) | — (không FK — mục xoá rồi lịch sử còn) | như trên |
| `ai_bot_pos_rules` | Sổ luật trả lời tự động của POS: first_message / keyword / regex / intent; `page_id` NULL = mọi page | — | Cài đặt AI (2 luật mặc định do migration thêm) |
| `ai_bot_jobs` | Hàng đợi: pending → running → done / failed / cancelled; `run_after`, `attempts`, khoá thuê `locked_by/until` | UNIQUE một phần (page, hội thoại) WHERE pending = mỗi hội thoại tối đa một job chờ | webhook, poller, nút "Xét lại ngay", worker |
| `ai_bot_locks` | Khoá thuê theo hội thoại (hết hạn tự nhả) | PK (page, hội thoại) | worker |
| `ai_bot_conversation_state` | Tạm dừng AI (`paused_until`, lý do, ai), ngôn ngữ, sản phẩm đang bàn, lần AI trả lời cuối | PK (page, hội thoại) | router, nút tạm dừng |
| `ai_bot_runs` | Nhật ký quyết định mỗi lượt khách: câu hỏi (đã che PII), phân loại, dữ liệu truy xuất, câu trả lời, provider/model, token, chi phí, độ tin cậy, thời gian, tag, các bước | **UNIQUE (page, hội thoại, turn_message_id)** = idempotency | router |
| `ai_bot_provider_calls` | Mỗi lượt gọi model (cả thử kết nối / chạy thử, cả lượt lỗi) — nguồn trần chi phí + thống kê | — | AI port |
| `ai_bot_outbox` | Giữ chỗ gửi TRƯỚC khi gọi Pancake; `sending` → `sent` / `failed` / `unknown` | **PK (page, hội thoại, turn_message_id)** = không gửi trùng | router |
| `ai_bot_notifications` | Thông báo Telegram | **UNIQUE `dedup_key`** (`esc:<page>:<hội thoại>:<lượt>`) | router |
| `ai_bot_webhook_log` | Webhook nhận được (rút gọn ≤ 8 KB, giữ 7 ngày) | — | route webhook |
| `ai_learning_questions` | Nhóm câu hỏi AI chưa trả lời được: câu mẫu, dạng chuẩn hoá, tập từ (gom nhóm Jaccard), số lần, trạng thái pending / processing / approved / ignored, câu trả lời, mục FAQ đã tạo | — | router, AI Learning |
| `ai_learning_occurrences` | Từng lần khách hỏi (nối về hội thoại) | UNIQUE (nhóm, page, hội thoại, tin) — một tin không đếm hai lần | router |
| `ai_learning_history` | Lịch sử xử lý nhóm câu hỏi | — | AI Learning |

## Migration 0010 — page tự động (26/11/2026)

`ai_bot_pages` thêm `mode` (auto mặc định — kể cả page chưa có dòng / on / off), `health` + `health_code` + `health_detail` +
`health_at` (worker ghi sau mỗi lượt quét), `alerted_at` (báo Telegram page lỗi 1 lần / ngày), `other_bot_at` (lần gần nhất
thấy bot khác gửi qua Public API). Page được xét = `pancake_pages` ⟕ `ai_bot_pages` qua luật `page-policy.ts → resolvePage`.
Dòng đã bật / tắt tay ở 0009 giữ đúng ý (bật = on, tắt = off).

## Dọn dữ liệu (chỉ sổ vận hành của module)

`worker.ts → cleanup()` mỗi 6 giờ: job đã xong > 14 ngày, webhook log > 7 ngày, khoá hết hạn > 1 ngày. **Không** đụng
`ai_bot_runs`, Knowledge Base, Learning, bảng cũ.

## Tương thích ngược / quay lui

* Migration chỉ `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` + 2 dòng luật mặc định (có `WHERE NOT EXISTS`).
* Code mới chạy được khi chưa migrate: worker đọc cài đặt lỗi → dùng gốc (AI tắt), route trả 503 "chưa chạy migration".
* Gỡ hẳn: xem DEPLOYMENT.md → "Quay lui".
