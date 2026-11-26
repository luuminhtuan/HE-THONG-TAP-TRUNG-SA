# AI Chatbot — Kiến trúc (Phase 2)

## 1. Nguyên tắc cốt lõi (không đổi)

AI **không thay** Pancake / POS. AI chỉ trả lời tin nhắn mà luật tự động bên Pancake KHÔNG xử lý, và chỉ khi có dữ liệu.
Thiếu dữ liệu → không suy diễn, chuyển Sale. Không chắc POS / Sale đã xử lý chưa → **không gửi**.

## 2. Thành phần

```
                         ┌─────────────── Intake ────────────────┐
 Pancake webhook ──POST /api/webhooks/pancake (chìa bí mật) ─┐     │  webhook = GỢI Ý (page, hội thoại)
 Poller (worker, mỗi N giây, page bật AI) ───────────────────┼──► ai_bot_jobs (hàng đợi Postgres, 1 job chờ / hội thoại)
 Nút "Chạy thử" (sandbox, không Pancake) ──────────────────────────► router chạy trong bộ nhớ
                                                                    │
                                    worker trong tiến trình Next (instrumentation.ts) — claim FOR UPDATE SKIP LOCKED
                                                                    │  + khoá thuê (lease) theo hội thoại ai_bot_locks
                                                                    ▼
 ┌───────────────────────────── Message Router (lib/ai-chatbot/router.ts — thuần, test được) ─────────────────────────────┐
 │ 1 cài đặt bật? page bật?   2 đọc hội thoại TƯƠI từ Pancake (nguồn sự thật, không tin payload webhook)              │
 │ 3 lượt khách chưa ai trả lời? (tin khách sau tin page cuối)   4 idempotency theo message id (ai_bot_runs UNIQUE)     │
 │ 5 debounce (khách gõ liên tiếp)  6 ân hạn POS (chờ luật tự động chạy)   7 sổ luật POS (tin đầu / từ khoá / regex)     │
 │ 8 Sale: gán ở dashboard · tag tắt AI · sale nhắn gần đây · tạm dừng tay   9 trần chi phí / nhịp gửi                   │
 │ 10 Classifier (model nhẹ, JSON + schema) → luật POS theo ý định (vd hỏi giá) → chuyển Sale theo ý định                │
 │ 11 RAG: ứng viên KB theo phạm vi page → nước → chung; loại giá/tồn kho cũ; xếp hạng từ khoá + trigram + truy vấn viết lại│
 │ 12 Generator (model chính, JSON) → kiểm tra căn cứ (số / giá / link / SĐT phải có trong nguồn), lộ prompt, ngôn ngữ   │
 │ 13 Confidence evaluator → < ngưỡng = chuyển Sale                                                                     │
 │ 14 ĐỌC LẠI hội thoại ngay trước khi gửi (khách nhắn thêm → xếp lại; page/sale vừa trả lời → bỏ)                      │
 │ 15 shadow: chỉ ghi log · live: outbox (UNIQUE) → gửi → gắn tag "Bot AI" (soát kết quả)                               │
 │ Chuyển Sale: tag "Bot AI - Cần hỗ trợ" + AI Learning + Telegram (chống trùng)                                         │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Thành phần | File | Ghi chú |
|:--|:--|:--|
| AI Provider | `lib/ai-chatbot/providers.ts` | DeepSeek + OpenAI (chuẩn OpenAI chat), Gemini. Timeout, retry 429/5xx, đếm token, tính tiền theo bảng giá trong luật, giới hạn lượt/phút |
| AI Router | `lib/ai-chatbot/router.ts` | Toàn bộ quyết định; phụ thuộc tiêm vào (store, chat, ai, notifier, clock) |
| AI Classifier | `lib/ai-chatbot/classifier.ts` | Prompt + kiểm schema + bộ phân loại dự phòng không cần AI |
| Knowledge Base | `lib/ai-chatbot/kb-store.ts`, `kb-sync.ts` | Bảng `ai_kb_entries` + lịch sử `ai_kb_revisions`; đồng bộ sản phẩm POS |
| Retrieval / RAG | `lib/ai-chatbot/retrieval.ts` | Thuần: chuẩn hoá không dấu, BM25 rút gọn + trigram (sai chính tả), độ tươi giá |
| Conversation Context | `lib/ai-chatbot/context.ts` | N tin gần nhất (cắt theo ký tự), sản phẩm đang bàn, ngôn ngữ, che SĐT/email trước khi gửi AI |
| Response Generator | `lib/ai-chatbot/generator.ts` | Prompt chống bịa + kiểm căn cứ + kiểm prompt injection |
| Confidence Evaluator | `lib/ai-chatbot/confidence.ts` | Gộp tín hiệu, cổng cứng |
| AI Learning | `lib/ai-chatbot/learning.ts` | Gom câu tương tự (Jaccard token), đếm lần, duyệt → FAQ |
| AI Analytics | `lib/ai-chatbot/store-pg.ts` (`stats`) | Từ `ai_bot_runs` + `ai_bot_provider_calls` |
| Telegram Notifier | `lib/ai-chatbot/telegram.ts` | Bot API `sendMessage`, HTML đã escape, chống trùng bằng `ai_bot_notifications` |
| Pancake adapter | `lib/ai-chatbot/pancake-client.ts`, `pancake-parse.ts` | Chỉ Public API chính thức + token page admin dán; đọc dự phòng bằng token tài khoản (đường đã dùng ở tab Tin nhắn) |
| Worker | `lib/ai-chatbot/worker.ts` | Vòng lặp trong tiến trình Next; tắt bằng `TALPHA_AI_WORKER=0` |

## 3. Chế độ chạy (an toàn mặc định)

| Cài đặt | Mặc định | Ý nghĩa |
|:--|:--|:--|
| `enabled` | **false** | Công tắc tổng. Tắt = worker chỉ đọc cài đặt, không gọi Pancake / AI |
| Page bật AI | **không page nào** | Bật từng page ở AI Settings |
| `mode` | **shadow** | Chạy đủ quy trình, ghi câu trả lời vào log, KHÔNG gửi, KHÔNG gắn tag |
| `live_test_conversations` | rỗng | Ở chế độ live: nếu có danh sách → CHỈ gửi cho các hội thoại này (staging với khách thử) |

## 4. Xác định "POS đã xử lý" — 3 lớp, thiên về an toàn

1. **Sổ luật POS** (`ai_bot_pos_rules`, sửa trên trang): `first_message` (tin đầu tiên của hội thoại), `keyword`,
   `regex`, `intent` (vd `price`). Khớp → AI bỏ qua, ghi lý do `pos_rule:<id>`. Mặc định có 2 luật: tin đầu tiên + hỏi giá
   (đúng ví dụ trong yêu cầu).
2. **Quan sát có kiểm chứng**: job chỉ chạy sau `pos_grace_seconds` kể từ tin khách; đọc lại hội thoại TƯƠI — có tin phía
   page sau lượt khách (tin `is_automated` / Botcake `app_id`,`flow_id`,`admin_name=Botcake` / tin hệ thống / sale) →
   `already_handled:<loại>`; không bao giờ trả lời đè.
3. **Đọc lại ngay trước khi gửi** (sau khi AI soạn): có tin page mới → bỏ; khách nhắn thêm → xếp lại cả lượt.
   Đọc Pancake lỗi ở bất kỳ bước nào → không gửi (thử lại theo `max_attempts`, hết lượt → ghi `error`, không gửi).

## 5. Chống xung đột / trùng

* Idempotency: `ai_bot_runs` UNIQUE (page_id, conversation_id, turn_message_id) — mỗi lượt khách chỉ một quyết định cuối.
* Outbox: `ai_bot_outbox` UNIQUE (page_id, conversation_id, turn_message_id) giữ chỗ TRƯỚC khi gửi; lỗi mơ hồ (timeout)
  → `unknown`, KHÔNG gửi lại, chuyển Sale.
* Hàng đợi: một job `pending` / hội thoại (UNIQUE một phần), claim `FOR UPDATE SKIP LOCKED` trong câu lệnh ngắn.
* Khoá thuê theo hội thoại `ai_bot_locks` (hết hạn tự nhả khi tiến trình chết) — không giữ transaction khi chờ AI.
* Job treo (`running` quá hạn) → về `pending`. Lượt khách cũ hơn `max_turn_age_minutes` → bỏ (`too_old`).
* Sale tiếp nhận giữa chừng → bước 14 bắt được (gán ở dashboard / tag tắt AI / tin sale mới) → bỏ câu đã soạn.

## 6. Bảo mật

* Khoá AI / Telegram / token page / chìa webhook: bảng `api_credentials` (mã hoá pgcrypto) qua `saveCredential()`.
* Route mới khai ở `API_RULES`; Settings chỉ giám đốc; leader chỉ thấy page / KB / log thuộc nước của team.
* Webhook: chìa bí mật so sánh hằng thời gian, giới hạn kích thước + tần suất; payload chỉ là gợi ý — nội dung tin luôn
  đọc lại từ Pancake bằng token của chính mình (giả mạo webhook không làm AI nói điều kẻ giả muốn).
* Prompt injection: tin khách đặt trong khối dữ liệu, prompt hệ thống cấm làm theo lệnh trong tin khách; dò mẫu tấn công;
  đầu ra bị chặn nếu có số / link / SĐT không có trong nguồn, lộ prompt hay khoá.
* Dữ liệu khách: che SĐT / email trước khi gửi AI; KB tách theo page / nước; bảng mới REVOKE khỏi vai chỉ đọc.
* Chi phí: trần ngày + tháng (USD), trần lượt trả lời / hội thoại / giờ, nhịp gửi theo page.
