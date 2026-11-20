-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0008 — chấm công online (20/11/2026): tab 🕒 Chấm công + /admin → Chấm công.
--
-- attendance_settings: MỘT dòng (id = 1) — mạng (IP / dải CIDR) và điểm văn phòng (toạ độ + bán kính) được chấm, cách
-- soát (IP · vị trí · một trong hai · cả hai), giờ vào / ra, ngày làm. Giám đốc sửa ở /admin → Chấm công. Chưa có dòng
-- thì dùng mặc định ở talpha_rules.json → attendance (không giới hạn nơi chấm).
--
-- attendance_punches: sổ chấm CHỈ THÊM. Mỗi lần bấm "Chấm vào" / "Chấm ra" một dòng, kèm IP máy chủ thấy, toạ độ GPS
-- trình duyệt gửi, điểm văn phòng khớp + khoảng cách — để giám đốc soát lại được. Giám đốc thêm giờ chấm bù (source =
-- 'manual', bắt buộc ghi chú) hoặc HUỶ một lần chấm sai (voided_at) — không xoá dòng nào. Ngày công (work_date) tính
-- theo attendance.timezone lúc ghi.
-- ═══════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS attendance_settings (
    id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config      jsonb       NOT NULL,
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_punches (
    id             bigserial   PRIMARY KEY,
    user_id        text        NOT NULL,                 -- users.id
    user_name      text,                                 -- tên lúc chấm — người đổi tên / bị xoá thì sổ cũ vẫn đọc được
    kind           text        NOT NULL CHECK (kind IN ('in', 'out')),
    at             timestamptz NOT NULL DEFAULT now(),
    work_date      date        NOT NULL,
    source         text        NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'manual')),
    ip             text,
    lat            double precision,
    lng            double precision,
    accuracy_m     double precision,
    location_name  text,                                 -- điểm văn phòng khớp (hoặc gần nhất khi không khớp)
    distance_m     double precision,
    network_name   text,                                 -- mạng khớp
    ip_ok          boolean,                              -- null = lúc chấm không soát IP
    location_ok    boolean,                              -- null = lúc chấm không soát vị trí
    user_agent     text,
    note           text,
    created_by     text,                                 -- người ghi (chấm bù: giám đốc)
    voided_at      timestamptz,
    voided_by      text,
    void_reason    text
);
CREATE INDEX IF NOT EXISTS attendance_punches_user_date_idx ON attendance_punches (user_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_punches_date_idx ON attendance_punches (work_date);

-- Bảng riêng — hai vai chỉ đọc không được thấy. Cùng danh sách PRIVATE_TABLES ở sync/core/pg_view.py.
REVOKE ALL ON attendance_settings, attendance_punches FROM talpha_readonly, talpha_readonly_market;
