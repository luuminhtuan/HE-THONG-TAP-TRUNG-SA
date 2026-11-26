# AI Chatbot — Phase 1: Phân tích hệ thống hiện tại

Ngày phân tích: 25/11/2026. Người làm: Claude (phiên tự động, user giao trọn đợt).

## 0. Điều chỉnh quan trọng so với bản yêu cầu

Bản yêu cầu viết cho **Laravel**. Repo thật (TALPHA) **không phải Laravel**:

| Yêu cầu giả định | Thực tế trong repo |
|:--|:--|
| Laravel controller / route | Next.js 16 App Router — `dashboard-ui/src/app/api/**/route.ts` |
| Eloquent + migration Laravel | Postgres + file SQL `db/migrations/NNNN_*.sql`, chạy bằng `python -m sync.core.pg migrate` (sổ `schema_migrations`) |
| Queue / Job / Listener / Scheduler | Không có Redis / queue. Việc nền = systemd timer (VPS) + `ops/docker/scheduler.py` (Docker). Hàng đợi phải tự dựng trên Postgres |
| Blade / Livewire | React 19 + Tailwind, tab trong `components/talpha/tabs/*` |
| Policy / Gate | `lib/talpha/access-rules.ts` (`API_RULES`, `canTab`, `canMarket`) + cửa `src/proxy.ts` |
| `.env` cho API key | Bảng `api_credentials` mã hoá pgcrypto (`lib/talpha/credentials.ts`, `getCredential()`) |

→ Module AI viết theo đúng kiến trúc thật: TypeScript trong `dashboard-ui/src/lib/ai-chatbot/`, route dưới
`/api/talpha/ai-chatbot/*`, bảng mới ở migration `0009_ai_chatbot.sql`, hàng đợi trên Postgres.

"Pancake POS" trong yêu cầu thực chất là **hai sản phẩm**:
* **Pancake (pages.fm)** — hộp thư Facebook page: hội thoại, tin nhắn, tag, luật trả lời tự động (Botcake, "POS Reply").
* **Pancake POS / Poscake (pos.pages.fm)** — shop bán hàng: sản phẩm, biến thể, giá, tồn kho, đơn.

## 1. Cấu trúc repo (phần liên quan)

```
dashboard-ui/src/app/api/talpha/messages/route.ts   tab 💬 Tin nhắn — CHỈ ĐỌC hộp thư từ DB + gán người / tag nội bộ
dashboard-ui/src/lib/talpha/pancake-inbox.ts         đọc pancake_* theo quyền nước
dashboard-ui/src/lib/talpha/inbox-meta.ts            gán người phụ trách (inbox_assignments), tag nội bộ, nhật ký inbox_events
dashboard-ui/src/lib/talpha/pancake.ts               PANCAKE_API = https://pages.fm/api/v1, PANCAKE_TOKEN_VARS
dashboard-ui/src/lib/talpha/credentials.ts           getCredential(), saveCredential() — khoá mã hoá trong api_credentials
dashboard-ui/src/lib/talpha/access-rules.ts          API_RULES, ALL_TABS, DIRECTOR_ONLY_TABS
dashboard-ui/src/lib/talpha/rules.ts                 RULES (talpha_rules.json + market_overrides), SHOP_POS, posMoneyDivisor()
dashboard-ui/src/instrumentation.ts                  chạy 1 lần lúc server khởi động
sync/core/pancake_inbox.py + sync/talpha/pancake_inbox_sync.py   kéo hội thoại/tin Pancake vào DB (30 phút/lần)
sync/talpha/sync_product_catalog.py                  kéo sản phẩm POS → product_catalog (mỗi ngày 05:10)
sync/core/pg_view.py → PRIVATE_TABLES                bảng riêng — REVOKE khỏi vai chỉ đọc
config/talpha_rules.json                             NGUỒN LUẬT DUY NHẤT (luật nghiệp vụ không gõ vào code)
```

## 2. Luồng tin nhắn hiện tại (truy vết thật)

1. `sync/talpha/pancake_inbox_sync.py` (VPS: `talpha-pancake.timer` mỗi phút `--if-due`, thực chạy 30 phút/lần;
   Docker: việc `tin_nhan`) gọi `https://pages.fm/api/v1/pages?access_token=<token tài khoản>` →
   `/pages/{id}/conversations?access_token&current_count` → `/pages/{id}/conversations/{cid}/messages?access_token&customer_id=<mã khách PANCAKE>`.
2. Chuẩn hoá ở `sync/core/pancake_inbox.py` (`normalize_conversation`, `normalize_message`: `from.id == page_id` → tin page).
3. Ghi `pancake_pages` / `pancake_conversations` / `pancake_messages` (migration 0004). Page hết gói cước → mã 121, bỏ qua.
4. Dashboard đọc qua `/api/talpha/messages` — **không gửi tin, không gắn tag lên Pancake** (tag + người phụ trách chỉ nội bộ).

→ TALPHA **chưa có đường GỬI tin nào**, không webhook, không queue. Luật trả lời tự động nằm **bên Pancake**
(Botcake, POS Reply) — TALPHA không đọc được.

## 3. Bot AI Sale cũ (`/Volumes/SSD/OTHER/Chat-Bot-AI-ATL-NEW-3-8`, Python) — nguồn kiểm chứng API

Đang chạy THẬT trên chính VPS TALPHA (`/opt/pancake-tool`, unit `aisale-chat-vietnam`, gửi thật). Đọc code (không chạy).
Bot ghi rõ 4 endpoint ghi "đã kiểm chứng bằng openapi.yaml chính thức của Pancake (2026-08-28)" (`ai_sale.py:130-131`).

| Việc | Cách bot cũ làm (chạy production nhiều tháng) | Nguồn |
|:--|:--|:--|
| Nhận tin | **Poll**, không webhook: `GET public_api/v2/pages/{id}/conversations?page_access_token&since&until&order_by=updated_at` | `quet_hoi_thoai.py:486-499` |
| Đọc tin | `GET public_api/v1/pages/{id}/conversations/{cid}/messages?page_access_token` | `ai_sale.py:9252` |
| Gửi tin | `POST public_api/v1/pages/{id}/conversations/{cid}/messages?page_access_token`, body `{"action":"reply_inbox","message":text}`; lỗi trả HTTP 200 + `success:false` | `ai_sale.py:419` |
| Tag | `GET public_api/v1/pages/{id}/tags` (đọc); `POST …/conversations/{cid}/tags` body `{"action":"add","tag_id":"<id>"}`. **Public API không tạo được tag** (`POST /pages/{id}/tags` → 404) → tag phải tạo tay trên Pancake | `ai_sale.py:440-505` |
| Token page | `POST https://pages.fm/api/v1/pages/{id}/generate_page_access_token?access_token=<token tài khoản>` — **SINH TOKEN MỚI VÔ HIỆU TOKEN CŨ** | `quet_hoi_thoai.py:296-318` |
| Ai gửi tin | `from.id != page_id` → khách; `from.admin_name == "Botcake"` → Botcake; không `admin_name` → tin hệ thống (lời chào tự động Facebook…); tên tài khoản AI ("Public API" khi gửi bằng token page) → AI; còn lại → sale. Đo 60 hội thoại UAE 03/09/2026 | `ai_sale.py:812-838` |
| Nhãn tự động của Pancake | tin Botcake mang `app_id` + `flow_id`; tin **luật trả lời của POS** mang `is_automated` (Pancake in "[POS Reply]") | `ai_sale.py:440-442` |
| Sale chen ngang | Ngay trước khi gửi đọc lại hội thoại: tin phía shop sau tin cuối của khách tăng, hoặc khách nhắn thêm → KHÔNG gửi | `ai_sale.py:181-199` |
| Tắt AI theo hội thoại | Tag "AI CHAT" trên Pancake (sale gắn) → AI im | `ai_sale.py:280-300` |
| Nhịp gửi | ≥ 20 s giữa hai tin CÙNG page, ≥ 3 s toàn cục, ≤ 10 tin/page/giờ — Facebook chặn #2022 khi gửi dồn | `ai_sale.py:104-125` |
| Lỗi #2022 | Facebook chặn kênh Public API theo page; bot né sang API nội bộ `pancake.vn/api/v1` bằng token tài khoản | `ai_sale.py:300-340` |

**Module mới KHÔNG dùng `pancake.vn/api/v1` (API nội bộ giao diện)** — đúng yêu cầu "không dùng endpoint nội bộ như API
chính thức". Hệ quả: page bị Facebook chặn #2022 thì module mới không gửi được → chuyển Sale (ghi ở FINAL-REPORT).

## 4. "POS có luật trả lời hay chưa" — cái gì kiểm chứng được

* **Không có API đọc luật trả lời tự động** của Pancake / Botcake (bot cũ không tìm thấy; public API chỉ có tin, tag, hội thoại).
* **Kiểm chứng được sau sự việc**: tin page do tự động hoá gửi mang dấu — `is_automated` (POS Reply), `app_id`/`flow_id`
  hoặc `admin_name = "Botcake"` (Botcake), không `admin_name` (tin hệ thống / lời chào Facebook).
* → Thiết kế 3 lớp (ARCHITECTURE.md §4): (1) **sổ luật POS khai trên trang** (tin đầu tiên, từ khoá, ý định "hỏi giá"…)
  khớp TRƯỚC khi gọi AI; (2) **chờ POS một khoảng ân hạn** rồi đọc lại hội thoại — có tin tự động / sale sau tin khách là
  POS đã xử lý; (3) **đọc lại lần cuối ngay trước khi gửi**. Không đọc được Pancake = KHÔNG gửi.

## 5. Sale / phân công

* TALPHA: gán người phụ trách hội thoại ở tab Tin nhắn (`inbox_assignments`) — module AI coi hội thoại đã gán = Sale xử lý.
* Pancake: tag tắt AI (mặc định "AI CHAT", cấu hình được) + tin của sale (người thật) trong N phút gần nhất.
* Không có API chính thức nào trả "sale đang mở hội thoại này" → ghi giới hạn (FINAL-REPORT).

## 6. Phân quyền

`proxy.ts` chặn mọi `/api/*` (trừ `/api/auth/*`): phải đăng nhập hoặc chìa nội bộ, rồi `checkApi()` theo `API_RULES`
(route chưa khai = chỉ giám đốc). Leader chỉ thấy nước của team (`a.codes`). Webhook từ ngoài cần ngoại lệ
`/api/webhooks/*` ở proxy — route tự xác thực bằng chìa bí mật.

## 7. Dữ liệu sản phẩm

`GET https://pos.pages.fm/api/v1/shops/{shop_id}/products?api_key&page_number&page_size=100` — `data[]` với `name`,
`custom_id`, `variations[]` (`retail_price`, `remain_quantity`, `display_id`, `images`) — chạy production
(`sync_product_catalog.py`). Tiền POS phải chia `posMoneyDivisor()` (Đài/Nhật/VN chia 1, SG/AE chia 100).

## 8. Rủi ro đã thấy

1. Bot AI Sale cũ đang gửi thật trên các page VN cùng VPS → bật module mới trên CÙNG page là hai bot trả lời một khách.
2. Sinh token page mới làm chết token bot cũ → module mới chỉ nhận token admin dán, KHÔNG tự sinh.
3. Facebook #2022 khi gửi dồn → giới hạn nhịp gửi theo page + toàn cục.
4. VPS 1 GB RAM — worker chạy trong tiến trình Next sẵn có, không thêm dịch vụ.
5. Kho local có dữ liệu khách thật (93 page, ~13.500 tin) — chỉ đọc; test dùng dữ liệu giả, không gửi dữ liệu khách ra AI.
6. Nghiên cứu tài liệu chính thức Pancake trên web bị chặn trong phiên này (công cụ WebFetch cần user duyệt quyền lúc user
   đang ngủ) → mọi endpoint lấy từ code đã chạy production, đánh dấu mức xác minh ở API-INTEGRATION.md.
