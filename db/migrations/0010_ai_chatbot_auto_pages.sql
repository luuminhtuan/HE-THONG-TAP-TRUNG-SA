-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0010 — AI Chatbot: page TỰ ĐỘNG (26/11/2026). User: "mỗi lần tạo page / page die phải cấu hình nhiều — không ổn".
--
-- Trước: mỗi page phải bật tay (ai_bot_pages.enabled). Nay mỗi page một CHẾ ĐỘ:
--   auto (mặc định, kể cả page CHƯA có dòng ở bảng này) — tự chạy khi đủ điều kiện (đã gán nước, đọc được tin, không bị
--        Pancake chặn, không có bot khác đang trả lời); page die / hết gói thì tự nghỉ, sống lại tự chạy.
--   on  — luôn bật (bỏ qua điều kiện "đã gán nước").   off — tắt hẳn.
-- Sức khoẻ page (health) do worker ghi sau mỗi lượt quét; other_bot_at = lần gần nhất thấy bot KHÁC gửi qua Public API.
-- Chỉ THÊM cột. Cột enabled giữ cho bản cũ (= mode 'on').
-- ═══════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'auto';
ALTER TABLE ai_bot_pages DROP CONSTRAINT IF EXISTS ai_bot_pages_mode_check;
ALTER TABLE ai_bot_pages ADD CONSTRAINT ai_bot_pages_mode_check CHECK (mode IN ('auto', 'on', 'off'));
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS health text;                -- ok / error
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS health_code text;           -- mã lỗi Pancake (105, 121, 122, token…)
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS health_detail text;
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS health_at timestamptz;
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS alerted_at timestamptz;     -- lần cuối báo Telegram page lỗi (1 lần / ngày)
ALTER TABLE ai_bot_pages ADD COLUMN IF NOT EXISTS other_bot_at timestamptz;

-- Dòng đã bật / tắt tay ở bản 0009 → giữ đúng ý người bật: bật = 'on', tắt = 'off'.
UPDATE ai_bot_pages SET mode = CASE WHEN enabled THEN 'on' ELSE 'off' END WHERE mode = 'auto' AND updated_by IS NOT NULL;
