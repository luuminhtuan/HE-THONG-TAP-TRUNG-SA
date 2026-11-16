-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0003 — kho của bot Zalo trong Postgres (16/11/2026)
--
-- Trước: bot giữ ba loại FILE trên máy chạy bot (ops/zalo-alerts/) — gỡ worktree / dựng lại máy là mất,
-- sao lưu database không mang theo, phiên đăng nhập nằm trần trên đĩa:
--   .zalo_session.json          → zalo_session        (MÃ HOÁ pgcrypto bằng TALPHA_ENCRYPTION_KEY, như api_credentials)
--   zalo_group_nuoc_<mã>.json   → zalo_market_groups  (nhóm nhận tin từng nước — chọn trên trang)
--   state.json                  → zalo_bot_state      (mốc đã gửi, số đã báo, tin đính chính chờ gửi…)
-- Bot KHÔNG nối thẳng Postgres: đọc / ghi qua /api/talpha/zalo/bot (chìa nội bộ) — ops/zalo-alerts/bot_store.js.
-- Lần đầu chạy bản này bot tự chép file cũ (nếu còn) vào ba bảng, soát khớp rồi xoá file.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Phiên đăng nhập của nick phụ (cookie + imei + userAgent — JSON). Một dòng duy nhất. Đổi TALPHA_ENCRYPTION_KEY
-- thì phiên không giải mã được → bot báo "chưa ghép nick", ghép lại trên trang.
CREATE TABLE zalo_session (
    id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    encrypted_value  bytea NOT NULL,
    account_name     text,
    saved_at         timestamptz NOT NULL DEFAULT now()
);

-- Nhóm "ADS + VẬN ĐƠN <nước>" nhận tin của từng nước. Không có dòng = bot không gửi gì cho nước đó.
CREATE TABLE zalo_market_groups (
    market      text PRIMARY KEY,                 -- mã nước: TW, SG, AE, JP, VN…
    group_id    text NOT NULL,
    group_name  text NOT NULL DEFAULT '',
    method      text,                             -- cách chọn: trang · tu-nhan · chon-tay
    chosen_at   timestamptz NOT NULL DEFAULT now()
);

-- Trạng thái bot, mỗi dòng MỘT mục: state.json cũ là object hai tầng ({moc: {"ads:TW:18:00": "2026-11-16"}, …}) —
-- section = khoá tầng một, item = khoá tầng hai; giá trị đứng riêng (vd nhomTuTrang) có item = ''.
-- Ghi theo từng mục nên bot dịch vụ và lệnh chạy tay (node bot.js --report …) sửa hai mục khác nhau không đè nhau.
CREATE TABLE zalo_bot_state (
    section     text NOT NULL,
    item        text NOT NULL DEFAULT '',
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (section, item)
);

-- Bảng riêng — hai vai chỉ đọc không được thấy. Cùng danh sách PRIVATE_TABLES ở sync/core/pg_view.py.
REVOKE ALL ON zalo_session, zalo_market_groups, zalo_bot_state FROM talpha_readonly, talpha_readonly_market;
