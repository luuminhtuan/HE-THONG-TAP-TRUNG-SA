-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0006 (15/11/2026) — dồn mọi dữ liệu còn nằm ở file vào Postgres.
--
--   app_documents           ← data/*.json (sao kê COD, việc đối soát, thanh toán QC, vận đơn,
--                             chi phí vận hành) — mỗi kho một dòng, nội dung jsonb như file cũ
--   market_overrides        ← data/thi_truong.json (nước thêm / sửa / tắt ở /admin → Thị trường)
--   market_monthly_reports  ← data/bao_cao_nuoc/<tháng>.json (số nước × người cho bot Zalo)
--   users                   ← config/users.json (hoặc biến USERS_JSON của máy chủ)
--   api_credentials         ← dashboard-ui/.env.khoa.local (token Meta, key POS, token Pancake,
--                             key 17TRACK) — MÃ HOÁ bằng pgcrypto, chìa ở biến TALPHA_ENCRYPTION_KEY
--   file_imports            ← sổ "file nào đã chép vào kho" — mỗi file chỉ chép MỘT lần
--
-- File cũ được chép vào ở bước `migrate` (sync/core/nhap_file.py), không xoá file.
-- Luật gốc config/talpha_rules.json VẪN ở git (có lịch sử, test chạy trên nó, view dựng từ nó).
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- pgp_sym_encrypt / pgp_sym_decrypt. Đặt ở schema public và gọi kèm tên schema (public.pgp_…):
-- test chạy migration trong schema tạm với search_path chỉ có schema đó.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS app_documents (
    name        text PRIMARY KEY CHECK (name ~ '^[A-Za-z0-9_-]+$'),
    content     jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_overrides (
    market_key  text PRIMARY KEY,
    settings    jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

CREATE TABLE IF NOT EXISTS market_monthly_reports (
    month       text PRIMARY KEY CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
    content     jsonb NOT NULL,
    written_at  timestamptz NOT NULL DEFAULT now()
);

-- username = tên đăng nhập (ô `email` của users.json cũ — "loc", "thai"…), so không phân biệt hoa thường.
CREATE TABLE IF NOT EXISTS users (
    id             text PRIMARY KEY,
    username       text NOT NULL,
    name           text NOT NULL,
    password_hash  text NOT NULL,
    role           text NOT NULL,
    teams          jsonb NOT NULL DEFAULT '[]'::jsonb,
    projects       jsonb NOT NULL DEFAULT '[]'::jsonb,
    status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));

-- name = tên biến cũ (TALPHA_META_ACCESS_TOKEN, TALPHA_POSCAKE_SG_KEY…): code đọc khoá theo tên này.
CREATE TABLE IF NOT EXISTS api_credentials (
    name             text PRIMARY KEY CHECK (name ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
    encrypted_value  bytea NOT NULL,
    note             text,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text
);

CREATE TABLE IF NOT EXISTS file_imports (
    source       text PRIMARY KEY,
    imported_at  timestamptz NOT NULL DEFAULT now(),
    detail       text
);

-- Hai vai chỉ đọc (migration 0003) chạy câu SQL do trình duyệt / AI "CEO hỏi" viết — KHÔNG được
-- thấy mật khẩu, khoá, tiền sao kê. pg_view.py cấp lại SELECT mọi bảng mỗi lần dựng view nên cũng
-- REVOKE lại đúng danh sách này (BANG_RIENG ở đó).
REVOKE ALL ON app_documents, market_overrides, market_monthly_reports, users, api_credentials, file_imports
    FROM talpha_doc, talpha_doc_nuoc;
