-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0002 — điều khiển bot Zalo từ trang /admin → Khoá kết nối → Zalo (16/11/2026)
--
-- Trước: ghép nick, chọn nhóm từng nước, gửi thử đều là lệnh gõ trên máy chạy bot (node pair.js …).
-- Nay trang ghi YÊU CẦU vào zalo_requests; bot (ops/zalo-alerts/bot_control.js) nhặt qua
-- /api/talpha/zalo/bot (chìa nội bộ), làm xong ghi kết quả + TRẠNG THÁI vào zalo_bot_status — như nút
-- "Cập nhật ngay" với lịch việc nền. Phiên đăng nhập Zalo (cookie) KHÔNG nằm ở đây: vẫn là file
-- .zalo_session.json trên máy chạy bot (phiên sinh ra ở máy nào dùng ở máy đó).
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- Một dòng duy nhất, bot ghi: đăng nhập chưa, nick nào, nhóm nick đang ở, nhóm đã chọn từng nước, mã QR
-- đang chờ quét (ảnh PNG base64 — chỉ giữ tới khi quét xong / hết hạn), nhịp tim.
CREATE TABLE zalo_bot_status (
    id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    logged_in     boolean NOT NULL DEFAULT false,
    account_name  text,
    markets       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- mã nước bot phục vụ (config.json → nhomNuoc.markets)
    groups        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id, name, members}] nhóm nick phụ đang ở
    market_groups jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {TW: {id, name}} nhóm nhận tin từng nước
    pairing       jsonb,                                -- {stage: qr|scanned|done|failed, qr_png, message, at}
    last_error    text,
    heartbeat_at  timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Yêu cầu bấm trên trang. Bot nhặt từng cái theo thứ tự (FOR UPDATE SKIP LOCKED), chạy, ghi kết quả.
CREATE TABLE zalo_requests (
    id            bigserial PRIMARY KEY,
    action        text NOT NULL CHECK (action IN ('pair', 'refresh_groups', 'set_group', 'send_test', 'unpair')),
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_by  text,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ok', 'failed')),
    result        text
);
CREATE INDEX zalo_requests_status_idx ON zalo_requests (status, id);

-- Bảng riêng (mã QR đăng nhập, tên nhóm nội bộ) — hai vai chỉ đọc không được thấy. Cùng danh sách
-- PRIVATE_TABLES ở sync/core/pg_view.py.
REVOKE ALL ON zalo_bot_status, zalo_requests FROM talpha_readonly, talpha_readonly_market;
