# AI Chatbot — Nhật ký thay đổi

## 25–26/11/2026 — bản đầu (commit + deploy 26/11, AI tắt + shadow trên máy chủ)

### Thêm
* Module `dashboard-ui/src/lib/ai-chatbot/` (22 file): router quyết định, provider DeepSeek / OpenAI / Gemini, classifier
  (+ dự phòng không cần AI), RAG (không dấu, viết tắt, sai chính tả, từ đồng nghĩa, truy vấn viết lại theo từng câu hỏi),
  sinh câu trả lời có soát căn cứ, chấm độ tin cậy, Pancake client (Public API chính thức + token page), Telegram,
  AI Learning, đồng bộ sản phẩm POS, kho Postgres (hàng đợi, khoá thuê, outbox), worker trong tiến trình.
* Migration `0009_ai_chatbot.sql` — 16 bảng `ai_*`, 2 luật POS mặc định.
* Route: `/api/talpha/ai-chatbot/{stats,logs,knowledge,learning,settings,sandbox,conversation,worker}`, `/api/webhooks/pancake`.
* Giao diện: nhóm menu 🧠 AI Chatbot — Tổng quan AI, Kiến thức (+ Chạy thử), AI Learning, Nhật ký AI, Cài đặt AI.
* Luật `config/talpha_rules.json → ai_chatbot` (mặc định tắt + shadow, bảng giá tham khảo, từ đồng nghĩa).
* Test: `tests/ai-chatbot-{core,router,adapters,pg}.test.cjs` + script `npm run test:ai-pg`.
* Tài liệu `docs/ai-chatbot/`.

### Sửa file cũ (nhỏ, có chú thích)
* `src/proxy.ts`: thả `/api/webhooks/*` (route tự xác thực bằng chìa + IP).
* `src/lib/talpha/access-rules.ts`: 5 tab mới (Cài đặt AI chỉ giám đốc), luật API cho route AI.
* `src/instrumentation.ts`: khởi động worker (lỗi không chặn dashboard).
* `components/talpha/nav-config.ts`, `dashboard-shell.tsx`: nhóm menu + 5 tab.
* `sync/core/pg_view.py`: bảng `ai_*` vào `PRIVATE_TABLES`.
* `dashboard-ui/package.json`: thêm test AI vào `npm test`, thêm `test:ai-pg`.
* `CLAUDE.md`, `DASHBOARD_MAP.md`: mục AI Chatbot.

### Lỗi tìm ra và đã sửa trong lúc làm
* Phân loại dự phòng không mở viết tắt ("ntn") và không nhận lời chào "Chào shop ạ".
* Truy vấn tìm kiếm cấp lượt bị áp cho mọi câu hỏi → câu "có ship không?" mượn truy vấn sản phẩm mà "khớp" kiến thức không
  trả lời nó → nay mỗi câu hỏi có truy vấn riêng.
* Giá cũ ẩn luôn tên biến thể (50ml) → nay chỉ ẩn giá + tồn kho.
* Gemini đời mới "suy nghĩ" ăn vào hạn token → JSON bị cắt; token suy nghĩ không được tính tiền → chừa chỗ + cộng tiền.
* Mã worker khác nhau giữa các bundle Next → giữ trên `globalThis`.
* Ảnh ở tin đầu tiên bị chuyển Sale trước khi xét luật POS "tin đầu".
* Payload webhook dài bị cắt giữa chuỗi JSON (JSON hỏng) → lưu `{truncated, head}`.

### Sửa sau review bảo mật độc lập (26/11/2026 — FINAL-AUDIT.md)
* Không đọc được tag / người phụ trách → không gửi (trước: coi như không có tag); tìm hội thoại có lật trang.
* Chìa nội bộ không bật được AI / đọc chìa webhook; URL webhook trả bản che.
* Soát căn cứ: chữ khách không là căn cứ (trừ số lượng nhỏ); link so nguyên origin + đường dẫn.
* Đọc lại cài đặt từ kho trước khi gửi; khoá theo job + gia hạn thuê + UPDATE kèm người giữ; không ghi đè lệnh tạm dừng của
  Sale; lọc ngày theo giờ VN; che SĐT ở mọi đường ra AI; outbox kẹt → chuyển Sale; job hỏng → lượt `error` trong nhật ký.
* Quét lật trang; job chờ thử lại không bị kéo sớm; chi phí lượt lỗi được ghi; giới hạn chạy thử; webhook log không lưu nội
  dung; quyền API theo đúng tab; chặn regex dễ treo.

### Page tự động — bớt cấu hình (26/11/2026, user: "page die / tạo mới liên tục, cấu hình nhiều quá")
* Migration `0010_ai_chatbot_auto_pages.sql`: chế độ page auto / on / off + sức khoẻ page + dấu bot khác.
* `page-policy.ts`: một luật quyết định page có chạy không + vì sao (đã gán nước, đọc được tin, gói cước, quyền, bot khác, lỗi).
* Token page tự đọc mỗi 30 phút (token đang dùng, không sinh mới), token hỏng thì đọc lại ngay.
* Page lỗi (die / hết gói / mất quyền) tự nghỉ `page_error_backoff_minutes` rồi tự thử lại; báo Telegram 1 lần / ngày.
* Nhận ra **bot khác** gửi qua Public API (vd bot AI Sale cũ) → hội thoại + page tự né (`other_bot_quiet_hours`); tag `AI SALE`
  thêm vào tag tắt AI.
* Tag "Bot AI" thành tuỳ chọn (page chưa tạo tag → bỏ qua, không lỗi).
* Shop POS mới tự đồng bộ sản phẩm ngay; quét 4 page song song.
* Cài đặt AI: mục "Việc cần làm", công tắc "Tự bật AI cho mọi page", bảng page có trạng thái + chế độ; thông số kỹ thuật gom
  vào "Nâng cao".
