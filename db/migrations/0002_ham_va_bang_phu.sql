-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0002 — hàm dùng chung cho câu SQL + các bảng phụ còn lại khi bỏ BigQuery (04/11/2026)
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ─── Hàm ───────────────────────────────────────────────────────────────────────────────
-- Câu SQL của dashboard, view và báo cáo viết trên BigQuery từ đầu. Mấy hàm dưới đây giữ ĐÚNG
-- nghĩa cũ ở những chỗ Postgres khác BigQuery mà khác thì ra số sai chứ không báo lỗi.

-- Chia luôn ra số thực, mẫu 0 / NULL thì NULL (như SAFE_DIVIDE). Postgres chia hai số nguyên là
-- chia nguyên — 3/4 = 0 — nên tỷ lệ % viết bằng dấu / trần sẽ ra 0 mà không ai thấy.
CREATE FUNCTION safe_divide(a double precision, b double precision) RETURNS double precision
    LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN b = 0 THEN NULL ELSE a / b END $$;

-- ROUND(số thực, n) — Postgres chỉ có ROUND(numeric, n); số thực thì báo "function does not exist".
CREATE FUNCTION round(x double precision, n integer) RETURNS double precision
    LANGUAGE sql IMMUTABLE AS $$ SELECT round(x::numeric, n)::double precision $$;

-- Chuỗi giờ POS ("2026-11-01T03:12:45.123", giờ UTC) → timestamp. Sai dạng → NULL, không làm
-- chết cả câu (như SAFE.PARSE_TIMESTAMP).
CREATE FUNCTION safe_ts(s text) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF s IS NULL OR btrim(s) = '' THEN RETURN NULL; END IF;
    RETURN replace(btrim(s), ' ', 'T')::timestamp;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- Ngày của một giờ UTC (chuỗi POS) theo múi giờ tz — như DATE(TIMESTAMP(s), tz).
CREATE FUNCTION ngay_theo_mui(s text, tz text) RETURNS date LANGUAGE sql STABLE AS $$
    SELECT ((safe_ts(s) AT TIME ZONE 'UTC') AT TIME ZONE tz)::date $$;

-- Chuỗi JSON → jsonb, hỏng → NULL (như JSON_EXTRACT_SCALAR gặp chuỗi không phải JSON).
CREATE FUNCTION safe_json(s text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN s::jsonb;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- ─── Danh mục sản phẩm (sync_product_catalog.py, thay cả bảng mỗi ngày) ───
CREATE TABLE product_catalog (
    variation_id    text NOT NULL,
    product_id      text,
    sku             text,
    product_name    text,
    variation_name  text,
    retail_price    double precision,
    cost            double precision,
    remain_quantity bigint,
    shop_label      text,
    image           text
);
CREATE INDEX product_catalog_bien_the ON product_catalog (variation_id);

-- ─── Ảnh chụp tồn kho — đường dự phòng của tab Kho khi POS chết (/api/talpha/sync-inventory) ───
CREATE TABLE inventory_snapshot (
    snapshot_time timestamptz NOT NULL,
    source        text,
    payload       text
);
CREATE INDEX inventory_snapshot_luc ON inventory_snapshot (snapshot_time DESC);

-- ─── Sức khoẻ vòng chạy (report_health.py) — bot Zalo đọc qua /api/talpha/sync-health ───
CREATE TABLE sync_health (
    ts        timestamptz NOT NULL,
    host      text,
    ok        boolean,
    sync_rc   bigint,
    format_rc bigint,
    detail    text
);
CREATE INDEX sync_health_luc ON sync_health (ts DESC);

-- ─── Sức khoẻ theo từng TKQC / shop (report_account_health.py) ───
CREATE TABLE sync_health_accounts (
    ts              timestamptz,
    run_ts          timestamptz,
    host            text,
    kind            text,
    entity_id       text,
    entity_name     text,
    rows_total      bigint,
    rows_recent     bigint,
    metric          double precision,
    prev_rows_total bigint,
    status          text
);
CREATE INDEX sync_health_accounts_luc ON sync_health_accounts (run_ts DESC);

-- ─── Bảng số báo cáo tháng (format_all.py) — thay cho việc đọc file Google Sheet ───
-- Mỗi dòng là MỘT tab của file "TỔNG TEAM THÁNG n", y hệt nội dung ghi lên Sheet: `hang` là mảng
-- các hàng (hàng đầu là tiêu đề, hàng cuối là TỔNG). Tab Tổng quan, P&L, Marketer và bot Zalo đọc
-- từ đây — cùng số với Sheet vì cùng một lần tính. Ghi đè trọn một tháng trong một transaction.
CREATE TABLE bao_cao_tab (
    thang   text        NOT NULL,          -- 'YYYY-MM'
    tep     text        NOT NULL,          -- 'tong_team'
    thu_tu  integer     NOT NULL,          -- thứ tự tab như trên Sheet
    ten_tab text        NOT NULL,
    hang    jsonb       NOT NULL,
    ghi_luc timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thang, tep, thu_tu)
);

-- ─── Vân tay bộ view — dựng lại view khi luật (tỷ giá, số chia, giá vốn…) đổi ───
CREATE TABLE view_van_tay (
    id      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    van_tay text        NOT NULL,
    dung_luc timestamptz NOT NULL DEFAULT now()
);
