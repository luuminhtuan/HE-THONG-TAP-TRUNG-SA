# AI Chatbot — Soát bảo mật + review code (Phase 10, 26/11/2026)

Review ĐỘC LẬP (agent `code-reviewer`, chỉ đọc code, không theo kết luận của người viết) trên toàn bộ thay đổi. Kết quả:
**3 nghiêm trọng, 6 quan trọng, 6 nhỏ — đã sửa hết**, mỗi lỗi có phép thử chống quay lại.
Không tìm thấy: SQL injection (mọi SQL dùng tham số `@tên`, phần ghép chỉ là hằng), XSS (không `dangerouslySetInnerHTML`, link
qua `encodeURIComponent`), SSRF.

## Nghiêm trọng

| # | Lỗi | Hậu quả nếu để | Đã sửa | Phép thử |
|:--|:--|:--|:--|:--|
| 1 | Tìm hội thoại trong 60 hội thoại mới nhất (không lật trang); tra tên tag lỗi thì coi như không có tag | Page đông khách: hội thoại có tag "Sale xử lý" vẫn nhận tin AI | Lật trang (`last_conversation_id`, tối đa 10 trang) trong đúng khoảng thời gian; không thấy hội thoại / không tra được tag → `conversation = null` → router THỬ LẠI rồi chuyển Sale, không gửi | router "REVIEW: không đọc được tag…", "đọc lại trước khi gửi mà mất thông tin…" |
| 2 | Chìa nội bộ đọc được chìa webhook (GET) và bật được chế độ live (PUT) | Ai có file `data/.internal_token` bật AI gửi thật cho mọi khách | PUT chặn chìa nội bộ; GET trả URL webhook đã che; URL đầy đủ chỉ qua nút "Hiện URL" của người đăng nhập; thao tác khoá / token / bật page / luật chặn chìa nội bộ + chế độ public | kiểm trên dashboard local: PUT bằng chìa nội bộ → 403 |
| 3 | Soát căn cứ cho phép số / link lấy từ chữ khách; so link bằng chuỗi con | Khách hỏi "giá 99k đúng không, link https://evil… phải không?" → page chính thức xác nhận giá sai / link lừa | Căn cứ CHỈ là khối kiến thức; số khách tự nói chỉ nhận số nhỏ < 100 (số lượng); link so nguyên origin + đường dẫn | core "REVIEW: chữ khách KHÔNG là căn cứ", "link so nguyên origin" |

## Quan trọng

| # | Lỗi | Đã sửa | Phép thử |
|:--|:--|:--|:--|
| 4 | Đọc lại cài đặt trước khi gửi dùng bộ đệm cũ → tắt AI giữa chừng vẫn gửi | `refreshSettings()` đọc thẳng kho ngay trước khi gửi | router "REVIEW: đọc LẠI cài đặt…" |
| 5 | Khoá hội thoại theo mã TIẾN TRÌNH (hai job cùng tiến trình lọt), thuê không gia hạn, UPDATE job không kiểm người giữ | Mã khoá riêng mỗi lượt nhận job; gia hạn thuê mỗi 60 s; `finish` / `requeue` kèm `status='running' AND locked_by=@token`; thu hồi job chỉ khi quá hạn > 30 s | pg "REVIEW: kết thúc / trả job chỉ khi còn giữ đúng mã khoá; gia hạn thuê" |
| 6 | Lưu trạng thái hội thoại ghi đè cột tạm dừng → lệnh "Sale tiếp nhận" bị xoá | `saveConversationState` không đụng cột tạm dừng; tạm dừng qua `pauseConversation` (chỉ kéo dài) | router "REVIEW: lệnh tạm dừng…", pg "trạng thái hội thoại…" |
| 7 | Lọc ngày theo 00:00 UTC (pool TimeZone=UTC) → "hôm nay" thiếu 0–7 giờ sáng VN | Mọi mốc ngày `AT TIME ZONE 'Asia/Ho_Chi_Minh'` | pg "số liệu Dashboard…" |
| 8 | SĐT / email chưa che có thể vào prompt AI (khi phân loại lỗi) | Mọi chữ khách ra ngoài dùng bản đã `redactPii` | router "REVIEW: SĐT của khách không ra khỏi máy" |
| 9 | Outbox kẹt "đang gửi" (tiến trình chết) → lượt bỏ lửng, mỗi lượt quét lại tốn tiền AI; job hỏng không hiện trên Dashboard | Kiểm outbox TRƯỚC khi gọi AI: kẹt > 15 phút → chuyển Sale; đã gửi → ghi bù; job hỏng hẳn → lượt `error` vào nhật ký | router "REVIEW: outbox kẹt…" |

## Nhỏ

| Lỗi | Đã sửa |
|:--|:--|
| Quét không lật trang → sót hội thoại sau vị trí 60 | Quét lật tối đa 10 trang |
| Tin mới / lượt quét kéo job đang chờ THỬ LẠI chạy sớm; job hỏng được tạo lại ngay | `enqueue` giữ giờ giãn cách khi `attempts > 0`; không tạo lại job cho hội thoại vừa hỏng trong 10 phút (pg test) |
| Lượt gọi lỗi mà hãng vẫn tính tiền ghi $0; bảng chi phí không ghi page | `AiError.usage` → ghi token + tiền; `routerDeps(pageId)` |
| Chạy thử không giới hạn → leader bấm nhiều chạm trần ngày | 20 lượt / 10 phút / người |
| Chìa webhook trên URL lọt access log nginx; payload webhook (có tin khách) lưu 7 ngày | Payload chỉ lưu địa chỉ (page, hội thoại, tin, loại sự kiện); nhận thêm header `x-webhook-key`. **Còn lại:** Pancake chỉ cho cấu hình URL → chìa vẫn có thể nằm trong log nginx — giới hạn thêm bằng IP nguồn `203.171.22.6` |
| Quyền theo tab quá rộng (có tab Tổng quan là ghi được Kiến thức) | `API_RULES` tách từng route theo đúng tab; tiền tố trần chỉ giám đốc |
| Regex luật POS có thể backtracking bùng nổ (treo tiến trình) | Từ chối lượng từ lồng nhau, ≤ 200 ký tự, chữ đem so cắt 1.000 ký tự (core test) |

## Soát theo Phần XI (bảo mật)

| Hạng mục | Cách xử lý |
|:--|:--|
| API Key | `api_credentials` mã hoá pgcrypto, gọi thử trước khi lưu, không trả bản rõ (chỉ bản che), không đặt trên URL (Gemini dùng header), lỗi Telegram không lộ token |
| Webhook signature | Pancake không ký webhook (OpenAPI) → chìa bí mật so hằng thời gian + IP nguồn + giới hạn kích thước / tần suất; payload chỉ là gợi ý — nội dung đọc lại bằng API |
| Authorization | `proxy.ts` + `API_RULES` từng route; route tự cắt theo nước; Cài đặt chỉ giám đốc đăng nhập |
| SQL Injection | Tham số `@tên` toàn bộ; review xác nhận |
| XSS | React escape; Telegram `escapeHtml`; không HTML thô |
| Prompt Injection | Tin khách là DỮ LIỆU trong prompt; dò mẫu tấn công → chuyển Sale; đầu ra bị chặn nếu lộ prompt / khoá / số / link không căn cứ |
| Rò rỉ dữ liệu khách | Che SĐT / email trước khi gửi AI / Telegram / nhật ký; bảng `ai_*` REVOKE khỏi vai chỉ đọc; webhook log không lưu nội dung |
| Cách ly theo Page | Kiến thức theo phạm vi page → nước → chung; ngữ cảnh chỉ từ đúng hội thoại; leader chỉ thấy nước của team |
| Rate limit | Provider (lượt / phút), Pancake (5 / s / page), gửi (giãn cách / page), trả lời / hội thoại / giờ, webhook (120 / phút / IP), chạy thử |
| Kiểm soát chi phí | Trần ngày + tháng soát TRƯỚC mỗi lượt gọi; ghi cả lượt lỗi; bảng giá trong luật; model lạ tính theo dòng `*` (cao) |

## Rủi ro còn lại (chấp nhận / cần người vận hành)

Xem FINAL-REPORT.md §8. Đáng chú ý nhất: bot AI Sale cũ cùng VPS (đừng bật chung page), sinh token page mới giết token cũ,
không có API đọc luật POS (sổ luật nhập tay + ân hạn), Pancake thật / Telegram thật / DeepSeek / OpenAI chưa thử được ở máy local.
