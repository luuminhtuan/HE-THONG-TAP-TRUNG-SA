# AI Chatbot — Tích hợp API (Phase 1, xác minh 25/11/2026)

Nguồn chính thức (OpenAPI do Pancake công bố — bản tải về lưu ở `reference/`):
* Pancake chat: https://developer.pancake.biz/openapi/openapi.yaml · webhook: https://developer.pancake.biz/openapi/webhook.yaml
* Pancake POS: https://docs.pancake.biz/pos/api/openapi.json
* Ghi chép đầy đủ + trích dẫn: `reference/pancake-api-research-2026-11-25.md`

Mức xác minh: **OFFICIAL** = có trong OpenAPI chính thức · **PROD** = đang chạy production (bot AI Sale / TALPHA) ·
**UNVERIFIED** = chưa thấy trong tài liệu, module không phụ thuộc.

## 1. Pancake chat (pages.fm)

| Việc | Method + endpoint | Xác thực | Tham số / thân | Trả về (phần dùng) | Mức | Module dùng |
|:--|:--|:--|:--|:--|:--|:--|
| Danh sách hội thoại gần đây | `GET https://pages.fm/api/public_api/v2/pages/{page_id}/conversations` | `page_access_token` (query) | `since`,`until` (Unix giây UTC), `order_by=updated_at`, `type[]=INBOX`; tối đa 60/lượt, lật bằng `last_conversation_id` | `conversations[]`: `id`, `type`, `updated_at`, `inserted_at`, `tags[{id,text}]` (có thể null), `assignee_ids`, `current_assign_users`, `last_sent_by{id,admin_name,is_automated,ai_generated}`, `customers[{id,fb_id,name}]` | OFFICIAL + PROD | Poller, đọc tag/người phụ trách |
| Tin của hội thoại | `GET https://pages.fm/api/public_api/v1/pages/{page_id}/conversations/{conversation_id}/messages` | `page_access_token` | `current_count` (30 tin trước vị trí) | `messages[]` (mới → cũ): `id`, `original_message`, `message` (HTML), `inserted_at` (UTC không múi), `from{id,name,admin_name,admin_id,uid,is_automated,ai_generated}`, `attachments[]` | OFFICIAL + PROD | Router đọc TƯƠI |
| Gửi tin | `POST https://pages.fm/api/public_api/v1/pages/{page_id}/conversations/{conversation_id}/messages` | `page_access_token` | JSON `{"action":"reply_inbox","message":"…"}` (`message` và `content_ids` loại trừ nhau) | HTTP 200 KHÔNG có nghĩa đã gửi: phải xem `success`; `id` tin đã gửi; lỗi có `message_code` | OFFICIAL + PROD | Gửi câu trả lời (chỉ chế độ live) |
| Danh sách tag page | `GET https://pages.fm/api/public_api/v1/pages/{page_id}/tags` | `page_access_token` | — | `tags[{id,text}]` | OFFICIAL + PROD | Tìm id tag theo tên |
| Gắn / gỡ tag | `POST https://pages.fm/api/public_api/v1/pages/{page_id}/conversations/{conversation_id}/tags` | `page_access_token` | JSON `{"action":"add"\|"remove","tag_id":"<id>"}` | `data` = mảng id tag SAU khi cập nhật, `success` | OFFICIAL + PROD | Gắn "Bot AI", "Bot AI - Cần hỗ trợ" — **soát `data` chứa id tag** mới ghi thành công |
| Tạo tag | `POST …/pages/{page_id}/tags` | — | — | 404 (bot cũ đo) | không có trong OpenAPI | **Không dùng** — tag tạo tay trên Pancake |
| Đọc token page CÓ SẴN | `GET https://pages.fm/api/v1/pages?access_token=<token tài khoản admin>&fields=activated{id,username,settings{page_access_token}}` | token tài khoản (chỉ admin page mới thấy `settings`) | — | `activated[].settings.page_access_token` | OFFICIAL | Nút "Lấy token page có sẵn" — KHÔNG sinh mới |
| Sinh token page | `POST https://pages.fm/api/v1/pages/{page_id}/generate_page_access_token` | token tài khoản | — | token mới, **VÔ HIỆU token cũ** | OFFICIAL | **Không dùng** — giết token bot AI Sale / tích hợp khác |
| Danh sách page | `GET https://pages.fm/api/v1/pages?access_token=` | token tài khoản | — | `categorized.activated[]` | PROD (TALPHA) | Dùng sẵn qua bảng `pancake_pages` |
| Đọc tin bằng token tài khoản | `GET https://pages.fm/api/v1/pages/{id}/conversations/{cid}/messages?access_token&customer_id=<mã khách Pancake>` | token tài khoản | `customer_id` bắt buộc trong thực tế | như trên | PROD (tab Tin nhắn) — `customer_id` UNVERIFIED | Đọc dự phòng ở chế độ shadow cho page chưa có token page |
| API nội bộ giao diện | `https://pancake.vn/api/v1/...` | token tài khoản | — | — | nội bộ | **Không dùng** (yêu cầu cấm) |

**Giới hạn**: 5 lượt / giây / page (OFFICIAL) → client giãn ≥ 250 ms giữa hai lượt cùng page, 429 thì chờ + thử lại.
Gửi dồn nhiều page → Facebook chặn #2022 (PROD, bot cũ đo 09/2026) → nhịp gửi ≥ `min_seconds_between_sends_page` / page.

**Nhận diện người gửi** (`pos-detect.ts → classifySender`):

| Dấu | Loại | Nguồn |
|:--|:--|:--|
| `from.id != page_id` | khách | OFFICIAL + PROD |
| `from.is_automated = true` | luật tự động / POS Reply | OFFICIAL ("sent automatically, e.g. by POS or an automation rule") |
| `from.ai_generated = true` và không phải tin của module | tự động hoá (AI của Pancake) | OFFICIAL |
| `from.admin_name` ~ "Botcake" / `app_id` + `flow_id` | Botcake | PROD (đo 03/09/2026); `app_id`/`flow_id` UNVERIFIED |
| không `admin_name` | tin hệ thống (lời chào Facebook, "đã trả lời quảng cáo") | PROD |
| id nằm trong outbox của module, hoặc `admin_name` thuộc `own_sender_names` (mặc định "Public API") | chính AI này | PROD |
| còn lại | người thật (sale) | PROD |

## 2. Webhook Pancake (chat)

* OFFICIAL: sự kiện `messaging` (`{page_id, event_type, data:{conversation, message, post}}`), `conversation`
  (`request_id`, `version`), `post`, `subscription`, `connect_status`. Đăng ký **chỉ trên giao diện Pancake** (Cài đặt page →
  Công cụ → Webhook), mỗi page bật webhook tốn 1 slot kết nối của gói.
* **Không có chữ ký** (HMAC) trong tài liệu. Chỉ có IP nguồn cố định `203.171.22.6`.
* Tự tắt nếu trong 30 phút > 80 % lỗi và ≥ 300 lượt lỗi → route trả 200 nhanh, xử lý bất đồng bộ.
* Module: `POST /api/webhooks/pancake?key=<chìa>` — soát chìa (so hằng thời gian) + IP nguồn (danh sách cấu hình, mặc định
  `203.171.22.6`, đọc `X-Real-IP` do nginx ghi đè) + kích thước ≤ 256 KB. Payload chỉ là **gợi ý** (page, hội thoại); nội
  dung luôn đọc lại bằng API. `from` trong webhook không có `admin_name`/`is_automated` (OFFICIAL) → không quyết định gì từ
  webhook.

## 3. Pancake POS (pos.pages.fm)

| Việc | Endpoint | Xác thực | Ghi chú | Mức |
|:--|:--|:--|:--|:--|
| Danh sách sản phẩm (biến thể) | `GET https://pos.pages.fm/api/v1/shops/{shop_id}/products/variations?page_size&page_number` | `api_key` (query) | mỗi phần tử = biến thể kèm sản phẩm; `retail_price`, `remain_quantity`, `variations_warehouses[]`; SP có `name`, `custom_id`, `note_product` (mô tả), `note` (ghi chú NỘI BỘ — module KHÔNG đưa cho AI) | OFFICIAL |
| Danh sách sản phẩm (cũ) | `GET …/shops/{shop_id}/products?page_number&page_size` | `api_key` | đang chạy ở `sync_product_catalog.py` | PROD, không có trong OpenAPI — module dùng làm dự phòng |
| Tiền | số nguyên theo đơn vị lưu: VND/TWD/JPY/PHP/IDR nguyên đơn vị, tiền khác ×100 | — | khớp `posMoneyDivisor()` | OFFICIAL |
| Webhook POS | cấu hình trên giao diện hoặc `PUT /shops/{id}` | — | `products`, `variations_warehouses`… | OFFICIAL — module chưa dùng (đồng bộ theo lịch `kb_sync_hours`) |

## 4. Nhà cung cấp AI

| Provider | Endpoint | Xác thực | JSON mode | Đếm token |
|:--|:--|:--|:--|:--|
| DeepSeek | `POST https://api.deepseek.com/chat/completions` (chuẩn OpenAI) · `GET /models` | `Authorization: Bearer` | `response_format: {type: json_object}` (prompt phải có chữ "json") | `usage.prompt_tokens / completion_tokens` |
| OpenAI | `POST https://api.openai.com/v1/chat/completions` · `GET /v1/models` | `Authorization: Bearer` | `response_format: {type: json_object}` | như trên |
| Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` · `GET …/v1beta/models` | header `x-goog-api-key` (không để khoá trên URL) | `generationConfig.responseMimeType = application/json` | `usageMetadata.promptTokenCount / candidatesTokenCount` |

Bảng giá (USD / 1 triệu token) ở `talpha_rules.json → ai_chatbot.pricing` — **số tham khảo, soát lại theo bảng giá hiện
hành của từng hãng trước khi tin con số chi phí**. Model lạ → dòng `*` (đặt cao để trần chi phí chặn sớm).

## 5. Telegram

`POST https://api.telegram.org/bot<token>/sendMessage` `{chat_id, text, parse_mode: "HTML", disable_web_page_preview: true}` ·
`GET …/getMe` để thử khoá. 429 trả `parameters.retry_after`. Chữ đã escape HTML (`text.ts → escapeHtml`).

## 6. Meta Graph API (không dùng trực tiếp)

Send API `POST /{PAGE-ID}/messages` (`recipient.id` = PSID, `messaging_type: RESPONSE`, cửa sổ 24 h — 7 ngày sau quảng cáo
Click-to-Messenger), webhook ký `X-Hub-Signature-256`. Module KHÔNG gọi Meta thẳng: page đã nối Pancake, gửi thẳng qua Meta
sẽ vượt mặt Pancake (sale không thấy tin trong Pancake, mất dấu tự động hoá). Ghi lại để mở rộng sau nếu cần.
