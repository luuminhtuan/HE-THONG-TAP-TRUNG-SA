# AI Chatbot — Báo cáo cuối (26/11/2026)

## 1. Đã triển khai

Module AI Chatbot chạy trong dashboard TALPHA (Next.js + Postgres — repo KHÔNG phải Laravel như bản yêu cầu giả định; làm
theo kiến trúc thật). AI chỉ trả lời tin Pancake mà luật tự động của POS không xử lý, và chỉ khi có dữ liệu; còn lại chuyển
Sale. Mặc định **tắt + shadow** (không gửi gì cho tới khi bật trên trang).

| Thành phần | Trạng thái | Ở đâu |
|:--|:--|:--|
| AI Provider (DeepSeek, OpenAI, Gemini; timeout, retry, đếm token, tính tiền, giới hạn lượt/phút, trần chi phí) | ✅ | `lib/ai-chatbot/providers.ts`, `runtime.ts → aiPort` |
| AI Router (toàn bộ luồng Phần V) | ✅ | `router.ts` |
| AI Classifier (JSON + schema, đa ngôn ngữ, không dấu, viết tắt, nhiều câu hỏi, dự phòng không cần AI) | ✅ | `classifier.ts` |
| Knowledge Base (CRUD, bật/tắt, xoá mềm, nguồn, lịch sử, phạm vi page/nước/chung, đồng bộ POS) | ✅ | `admin-store.ts`, `kb-sync.ts`, `kb-pos.ts`, tab Kiến thức |
| RAG (lọc phạm vi, BM25 rút gọn + trigram + đồng nghĩa + truy vấn viết lại theo câu, độ tươi giá) | ✅ | `retrieval.ts` |
| Ngữ cảnh hội thoại (N tin gần nhất, sản phẩm đang bàn, ngôn ngữ, che SĐT/email) | ✅ | `context.ts`, `ai_bot_conversation_state` |
| Response Generator + soát căn cứ (số / giá / link / SĐT / email phải có trong nguồn; lộ prompt; ngôn ngữ) | ✅ | `generator.ts` |
| Confidence Evaluator | ✅ | `confidence.ts` |
| AI Learning (gom nhóm, đếm lần, duyệt → FAQ, bỏ qua, mở lại, lịch sử) | ✅ | `learning.ts`, tab AI Learning |
| AI Analytics (tiếp nhận, trả lời, chuyển Sale, tỷ lệ tự xử lý, token, chi phí, chủ đề, theo page, theo ngày) | ✅ | tab Tổng quan AI |
| Telegram (cấu hình, thử kết nối, chống báo trùng, lỗi không làm hỏng lượt) | ✅ (chưa thử với bot thật) | `telegram.ts` |
| Xác định "POS đã xử lý" — sổ luật + ân hạn rồi đọc lại (`from.is_automated` OFFICIAL) + đọc lại trước khi gửi | ✅ | `pos-detect.ts`, router |
| Chống trùng / xung đột (idempotency, hàng đợi 1 job chờ / hội thoại, SKIP LOCKED, khoá thuê, outbox, job treo) | ✅ (test Postgres thật) | `store-pg.ts`, `worker.ts` |
| Tag "Bot AI" / "Bot AI - Cần hỗ trợ" (soát kết quả từ `data` của API) | ✅ code — tag phải tạo tay trên Pancake | `pancake-client.ts → addTag` |
| Webhook (chìa + IP, payload chỉ là gợi ý) + quét theo lịch | ✅ | `/api/webhooks/pancake`, `worker.ts` |
| Giao diện 5 tab + Chạy thử | ✅ | `components/talpha/tabs/ai-chatbot/` |
| Logs | ✅ | tab Nhật ký AI |

## 2. Kiểm thử

Xem TEST-REPORT.md. Tóm tắt: 43 lõi + 46 router (đủ 18 tình huống) + 19 bộ chuyển đổi + 18 Postgres thật — đều đạt; test cũ
dashboard + 211 test Python vẫn đạt; build production OK; chạy thử với Gemini thật trên dữ liệu giả cho kết quả đúng (trả lời
đúng ngôn ngữ, có căn cứ; thiếu dữ liệu → chuyển Sale; hỏi giá → nhường POS; prompt injection → chặn). Review bảo mật độc lập
tìm 15 lỗi (3 nghiêm trọng) — đã sửa hết, xem FINAL-AUDIT.md.

## 3. Tiêu chí hoàn thành (Phần XVI)

| # | Tiêu chí | Trạng thái |
|:--|:--|:--|
| 1 | AI Provider hoạt động | ✅ Gemini thật (test kết nối + sandbox). DeepSeek / OpenAI: code + test giả, **chưa có khoá để thử thật** |
| 2 | AI Classifier hoạt động | ✅ |
| 3 | Knowledge Base hoạt động | ✅ (đồng bộ POS: code xong, **chưa chạy với POS thật ở local** — xem §4) |
| 4 | RAG hoạt động | ✅ |
| 5 | Message Router hoạt động | ✅ (test + Postgres thật; **chưa chạy với Pancake thật**) |
| 6 | Cơ chế xác định POS đã xử lý | ✅ 3 lớp; giới hạn: không có API đọc luật → sổ luật khai tay |
| 7 | AI trả lời đúng ngôn ngữ | ✅ (soát + đo với AI thật) |
| 8 | AI không tự bịa | ✅ soát căn cứ + ngưỡng tin cậy (giảm thiểu, không thể chứng minh tuyệt đối) |
| 9 | Chuyển Sale | ✅ |
| 10 | Telegram | ✅ code + test giả — **NOT VERIFIED với bot thật** (chưa có token) |
| 11 | Tag hoặc báo rõ giới hạn API | ✅ code; giới hạn: Public API không tạo tag → tạo tay |
| 12 | Dashboard | ✅ |
| 13 | AI Learning | ✅ |
| 14 | Logs | ✅ |
| 15 | Test | ✅ |
| 16 | Không làm hỏng chức năng cũ | ✅ test cũ + Python đạt; module chat cũ không bị sửa (chỉ đọc bảng) |
| 17 | Tài liệu cài đặt và cấu hình | ✅ DEPLOYMENT.md |

**NOT COMPLETED (cần môi trường / quyền thật):** kiểm gửi tin + gắn tag + webhook trên Pancake thật; Telegram thật;
DeepSeek / OpenAI thật. Code sẵn, bước kiểm ở DEPLOYMENT.md §4.

## 4. API cần bổ sung quyền

* **Token page Pancake** (đọc có sẵn bằng token tài khoản ADMIN của page — `GET /pages?fields=activated{id,settings{page_access_token}}`).
  Token Pancake ở máy local hiện báo mã 105 / 122 (hết quyền / hết gói).
* Gói cước Pancake phủ các page bật AI (page ngoài gói: mã 121).
* Khoá DeepSeek / OpenAI (tuỳ chọn), Bot Token Telegram + Chat ID.
* Nếu bật webhook: mỗi page tốn 1 slot kết nối của gói Pancake.

## 5. Biến môi trường

Không cần biến mới bắt buộc. `DASHBOARD_HTTPS_HOST` (đã có trên VPS) cho link; `TALPHA_AI_WORKER=0` để tắt worker. Khoá nhập
trên trang (mã hoá). Chi tiết: DEPLOYMENT.md §2.

## 6. Việc làm tay

Commit + deploy (chưa làm — chờ user); tạo 2 tag trên Pancake; đọc / dán token page; nhập khoá AI + chọn model + test; cấu hình
Telegram; khai sổ luật POS; đồng bộ sản phẩm POS + nhập chính sách / FAQ; (tuỳ chọn) cho leader thấy tab AI. DEPLOYMENT.md §3.

## 7. Bật an toàn trên staging

Shadow 1 page vài ngày → live chỉ hội thoại thử → live 1 page → mở rộng. Dừng khẩn cấp = công tắc tổng. DEPLOYMENT.md §4.

## 8. Rủi ro còn tồn tại

1. **Bot AI Sale cũ** đang gửi thật trên các page VN cùng VPS: bật module mới trên CÙNG page = hai bot trả lời một khách.
2. **Sinh token page mới** (trên giao diện Pancake hoặc API) làm chết token bot cũ — module không bao giờ sinh, nhưng người
   vận hành có thể bấm nhầm.
3. **Facebook #2022**: gửi qua Public API dồn dập có thể bị chặn theo page (bot cũ né bằng API nội bộ — module mới KHÔNG dùng
   API nội bộ, nên page bị chặn = không gửi được, chuyển Sale). Đã có giãn cách gửi theo page.
4. **Không có API đọc luật POS** → nếu sổ luật khai thiếu và POS trả lời chậm hơn ân hạn (mặc định 45 s), AI có thể trả lời
   trước POS. Giảm thiểu: đọc lại ngay trước khi gửi; tăng `pos_grace_seconds` nếu POS chậm.
5. **Chất lượng câu trả lời phụ thuộc Knowledge Base**: kiến thức sai → AI nói sai (đúng "căn cứ"). Mục admin có lịch sử.
6. **Bảng giá model** trong luật là số tham khảo; model mới (gemini-3.x) chưa có giá → tính theo dòng `*` (cao).
7. Worker chạy trong tiến trình dashboard: dashboard khởi động lại thì job đang chạy treo tới hết hạn thuê rồi chạy lại (an toàn
   nhờ outbox; lượt đang gửi dở có thể thành `unknown` → chuyển Sale).
8. Poller lật tối đa 10 trang × 60 hội thoại / page / lượt quét — page cực đông vẫn có thể sót; webhook bù được.
9. **Model AI quá tải**: đo 26/11/2026 `gemini-flash-lite-latest` trả 503 "high demand" vài lần. Đã có: thử lại 3 lần →
   phân loại lỗi thì thử bằng model trả lời → vẫn lỗi thì phân loại dự phòng (độ tin cậy bị kẹp ≤ 0,7 < ngưỡng 0,75 = chuyển
   Sale, không trả lời bừa). Nên chọn model ổn định (không bản "preview") cho production.

## 9. Trạng thái máy local khi bàn giao

* DB local đã chạy migration 0009. Cài đặt AI local: **AI TẮT**, shadow, model Gemini (`gemini-flash-lite-latest` /
  `gemini-3.5-flash`), 2 mục kiến thức "DỮ LIỆU THỬ" (#3, #4) để chạy thử — xoá ở tab Kiến thức khi không cần.
* Lúc bàn giao (sáng 26/11) chưa commit / deploy. Chiều 26/11 user yêu cầu → commit `main` + đưa lên VPS (AI vẫn tắt + shadow).
* `.claude/settings.local.json` (không commit): đã thêm quyền Edit trong repo + Bash + WebFetch/WebSearch theo yêu cầu "yes
  hết, không cần confirm" — gỡ nếu muốn Claude hỏi lại như cũ.
