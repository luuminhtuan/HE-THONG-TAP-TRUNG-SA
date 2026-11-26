# AI Chatbot — Cài đặt, cấu hình, bật an toàn, quay lui

> 26/11/2026: commit lên `main` và đưa lên máy chủ theo yêu cầu. Trên máy chủ AI vẫn **TẮT** + shadow — các bước bật ở mục 3–4.

## 1. Cài đặt

1. Commit + đẩy như thường lệ (`git push upstream main` — xem CLAUDE.md "Deploy").
2. Migration `db/migrations/0009_ai_chatbot.sql` tự chạy ở bước migrate (Docker: service `migrate`; VPS: `vps-setup.sh` /
   `python -m sync.core.pg migrate`). Chỉ thêm bảng `ai_*` + 2 luật POS mặc định.
3. Không cần dịch vụ mới: worker chạy trong tiến trình dashboard (pm2 `talpha-dashboard` / container `dashboard`).
   Tắt worker ở một tiến trình: `TALPHA_AI_WORKER=0`.
4. Sau deploy, AI **ĐANG TẮT**, chế độ **shadow**, **không page nào bật** — không có gì chạy cho tới khi bật trên trang.

## 2. Biến môi trường

| Biến | Bắt buộc | Ghi chú |
|:--|:--|:--|
| `DATABASE_URL`, `TALPHA_ENCRYPTION_KEY` | có (đã có sẵn) | khoá AI / Telegram / token page lưu mã hoá bằng chìa này |
| `DASHBOARD_HTTPS_HOST` | nên có | để link trong Telegram + URL webhook đúng địa chỉ (VPS đã đặt) |
| `TALPHA_AI_WORKER` | không | `0` = tắt worker ở tiến trình này |

Khoá KHÔNG đặt trong `.env`: nhập ở **🧠 AI Chatbot → Cài đặt AI** (gọi thử rồi mới lưu, mã hoá trong `api_credentials`):
`AI_DEEPSEEK_API_KEY`, `AI_OPENAI_API_KEY`, `AI_GEMINI_API_KEY` (trống = dùng `GEMINI_API_KEY` của "Hỏi AI"),
`AI_TELEGRAM_BOT_TOKEN`, `AI_PANCAKE_PAGE_TOKEN_<page_id>`, `AI_PANCAKE_WEBHOOK_SECRET` (nút "Tạo chìa").

## 3. Việc làm tay MỘT LẦN (không cấu hình từng page)

Từ 26/11/2026 page chạy **TỰ ĐỘNG** (migration 0010): page mới nối Pancake tự được nhận, tự đọc token page (token đang dùng
— không sinh mới), tự chạy khi đã gán nước; page die / hết gói / mất quyền tự nghỉ rồi tự thử lại; page đang có bot khác
trả lời (vd bot AI Sale cũ) tự né. Tag "Bot AI" là TUỲ CHỌN. Trang Cài đặt AI có mục **"Việc cần làm"** tự đánh dấu.

1. **Token tài khoản Pancake** (Quản trị → Khoá kết nối): tài khoản là ADMIN các page và CÓ GÓI CƯỚC. Token page tự đọc từ đây.
2. **Khoá AI**: Cài đặt AI → Khoá → "Thử + lưu"; chọn model → Lưu → "Test kết nối". Đo 26/11/2026: `gemini-2.5-flash` đã bị
   Google ngừng cho tài khoản mới; `gemini-flash-lite-latest` + `gemini-3.5-flash` chạy được (flash-lite thỉnh thoảng 503 —
   phân loại tự chuyển sang model trả lời).
3. **Kiến thức**: sản phẩm POS tự đồng bộ (shop POS mới tự đồng bộ ngay); chỉ cần nhập chính sách đổi trả, giao hàng,
   bảo hành… theo nước.
4. **Telegram** (tuỳ chọn): tạo bot @BotFather, thêm vào nhóm, dán token + chat id, "Gửi tin thử". Nhận cả báo page lỗi.

Không bắt buộc: tạo tag trên Pancake (có thì AI gắn, không có thì bỏ qua), sổ luật POS (có sẵn 2 luật: tin đầu + hỏi giá),
đổi chế độ từng page (chỉ khi muốn ép "Luôn bật" page chưa gán nước, hoặc "Tắt" một page).

## 4. Bật an toàn

1. **Shadow**: bật công tắc tổng, giữ chế độ shadow. MỌI page đủ điều kiện sẽ được AI đọc + soạn (không gửi) → TỐN TIỀN AI
   theo số tin khách (trần mặc định $2 / ngày). Muốn thử 1 page trước: bấm "TỰ BẬT AI CHO MỌI PAGE" để chuyển sang
   "CHỈ PAGE BẬT TAY", rồi đặt page đó "Luôn bật".
2. Đọc **Nhật ký AI** vài ngày; trả lời câu hỏi ở **AI Learning**.
3. **Live với hội thoại thử**: chế độ live + điền `conversation_id` (lấy ở Nhật ký AI) vào ô "Chỉ gửi thật cho các hội thoại".
   Live cần token page — page chưa đọc được token tự nghỉ (không chuyển Sale hàng loạt).
4. **Live toàn bộ**: xoá danh sách hội thoại thử. Theo dõi Tổng quan AI + chi phí.

**Dừng khẩn cấp**: tắt công tắc tổng (≤ 10 giây). Một hội thoại: Nhật ký AI → "Sale tiếp nhận (dừng AI 24h)", hoặc sale gắn tag
`AI CHAT` trên Pancake. Một page: chế độ "Tắt".

## 5. Quay lui

* Tắt: công tắc tổng → AI tắt (không cần deploy).
* Gỡ code: revert commit → dashboard không còn tab / worker. Bảng `ai_*` để nguyên không ảnh hưởng gì.
* Gỡ hẳn bảng (mất nhật ký AI, kiến thức, Learning — sao lưu trước):
  `pg_dump -t 'ai_*' "$DATABASE_URL" > ai_chatbot_backup.sql` rồi `DROP TABLE` các bảng `ai_*` và
  `DELETE FROM schema_migrations WHERE name = '0009_ai_chatbot.sql'`; xoá khoá `AI_*` ở Khoá kết nối.

## 6. Phân quyền

Tab 🧠 AI Chatbot mặc định **chỉ giám đốc** (không đổi quyền ai đang có). Cho leader xem / sửa kiến thức + Learning + Nhật ký
của nước mình: thêm `"ai-overview", "ai-knowledge", "ai-learning", "ai-logs"` vào `talpha_rules.json →
access.roles.leader.tabs` (route đã tự cắt theo nước). "Cài đặt AI" luôn chỉ giám đốc.

## 7. Chạy test

```bash
cd dashboard-ui && npm test                                    # gồm 98 phép thử AI (lõi, router, bộ chuyển đổi)
DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha npm run test:ai-pg   # Postgres thật, tự dọn dữ liệu thử
```
