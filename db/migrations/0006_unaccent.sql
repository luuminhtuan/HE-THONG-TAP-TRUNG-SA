-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0006 — tìm KHÔNG DẤU ở tab Tin nhắn (17/11/2026): gõ "thu" ra cả "Thư", "Thu", "Thứ"; "dang" ra "Đặng".
-- unaccent là extension "trusted" (Postgres ≥ 13) — chủ database tạo được, không cần superuser. Máy chủ: gói
-- postgresql-contrib (cài ở vps-postgres-setup.sh prepare, cùng pgcrypto).
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
