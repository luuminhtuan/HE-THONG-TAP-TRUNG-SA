-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0001 — cấu trúc kho số Postgres, tên tiếng Anh từ đầu (16/11/2026)
--
-- Gộp 9 migration của nhánh kho-postgres (04–16/11/2026) thành MỘT file dựng thẳng cấu trúc cuối.
-- Nhánh đó chưa từng lên production nên không có kho nào cần nâng cấp: không còn bước đổi tên bảng /
-- cột / giá trị (tkqc → ad_accounts, fb_*_tat_ca → fb_*_all, bao_cao_tab → monthly_report_tabs…).
-- Kho dựng bằng code kho-postgres cũ KHÔNG chạy tiếp được trên file này — xoá DB rồi dựng lại
-- (docs/POSTGRES.md → "Chuyển từ kho-postgres").
--
-- Từ đây: thêm cột / bảng bằng file migration MỚI (0002_…), đừng sửa file này — máy đã chạy nó sẽ
-- không chạy lại, hai máy ra hai cấu trúc khác nhau.
--
-- Hai tầng như BigQuery cũ (sync/core/pg_writer.py): <bảng>_raw chỉ GHI THÊM, không bao giờ xoá; bảng
-- sạch dựng lại từ raw trong MỘT transaction mỗi vòng sync. Thêm cột thì thêm vào CẢ bảng sạch lẫn _raw.
-- Không khai khoá chính cho bảng số: đơn thiếu mã mà làm hỏng cả vòng ghi là mất số của mọi shop;
-- bảng sạch đã duy nhất theo khoá nhờ bước dựng lại (DISTINCT ON).
-- Ngày giờ của đơn (inserted_at, updated_at, sync_time…) giữ dạng CHUỖI: luật chọn đơn so chuỗi
-- (pg_writer.select_orders_to_upsert) và câu SQL của dashboard cắt SUBSTR(inserted_at, 1, 10).
-- ═══════════════════════════════════════════════════════════════════════════════════════


-- ═══ 1. Số sync kéo về mỗi giờ ══════════════════════════════════════════════════════════

-- ─── Đơn POS ───
CREATE TABLE sale_order (
    id                     text,
    shop_id                text,
    shop_label             text,
    status                 text,
    status_name            text,
    status_category        text,
    status_sub             text,
    total_price            double precision,
    shipping_fee           double precision,
    cod                    double precision,
    total_discount         double precision,
    partner_fee            double precision,
    return_fee             double precision,
    surcharge              double precision,
    money_to_collect       double precision,
    total_quantity         text,
    marketer               text,
    ad_id                  text,
    adset_id               text,
    ads_source             text,
    page_id                text,
    post_id                text,
    p_utm_source           text,
    p_utm_campaign         text,
    p_utm_medium           text,
    p_utm_content          text,
    p_utm_term             text,
    p_utm_id               text,
    order_currency         text,
    customer_id            text,
    customer_name          text,
    bill_full_name         text,
    bill_phone_number      text,
    shipping_address       text,
    shipping_province      text,
    shipping_district      text,
    partner                text,
    warehouse_id           text,
    tracking_link          text,
    inserted_at            text,
    updated_at             text,
    time_send_partner      text,
    estimate_delivery_date text,
    note                   text,
    tags                   text,
    order_link             text,
    sync_time              text,
    page_name              text,
    seller_name            text
);
CREATE TABLE sale_order_raw (LIKE sale_order);
CREATE INDEX sale_order_shop_order_idx ON sale_order (shop_id, id);
CREATE INDEX sale_order_inserted_at_idx ON sale_order (inserted_at);
CREATE INDEX sale_order_raw_shop_order_idx ON sale_order_raw (shop_id, id);

-- ─── Dòng hàng của đơn ───
CREATE TABLE order_items (
    item_id               text,
    order_id              text,
    shop_id               text,
    shop_name             text,
    project_id            text,
    product_id            text,
    variation_id          text,
    product_name          text,
    variation_name        text,
    barcode               text,
    quantity              bigint,
    return_quantity       bigint,
    returned_count        bigint,
    returning_quantity    bigint,
    retail_price          double precision,
    discount_each_product double precision,
    total_discount        double precision,
    same_price_discount   double precision,
    avg_imported_price    double precision,
    is_bonus_product      text,
    is_composite          text,
    is_wholesale          text,
    order_inserted_at     text,
    sync_time             text
);
CREATE TABLE order_items_raw (LIKE order_items);
CREATE INDEX order_items_shop_order_idx ON order_items (shop_id, order_id);
CREATE INDEX order_items_raw_shop_order_sync_idx ON order_items_raw (shop_id, order_id, sync_time);

-- ─── Chi tiêu quảng cáo của MỌI TKQC theo ad × ngày (spend đã là VND) ───
-- fb_ads_data / fb_adset_data / fb_campaign_data là VIEW chỉ gồm TKQC thuộc loại vào báo cáo
-- (db/views/00_fb_*.sql, talpha_rules.json → ad_account_categories) — đọc tên đó là tự đúng.
-- Đừng ghi thẳng vào view.
CREATE TABLE fb_ads_all (
    ad_id                           text,
    ad_name                         text,
    adset_id                        text,
    adset_name                      text,
    campaign_id                     text,
    campaign_name                   text,
    account_id                      text,
    account_name                    text,
    date                            date,
    spend                           double precision,
    spend_usd                       double precision,
    impressions                     bigint,
    clicks                          bigint,
    reach                           bigint,
    purchases                       bigint,
    purchase_value                  double precision,
    leads                           double precision,
    messaging_conversations_started bigint,
    add_to_cart                     bigint,
    cpm                             double precision,
    ctr                             double precision,
    cpc                             double precision,
    frequency                       double precision,
    project_id                      text,
    sync_time                       text
);
CREATE TABLE fb_ads_all_raw (LIKE fb_ads_all);
CREATE INDEX fb_ads_all_date_idx ON fb_ads_all (date);
CREATE INDEX fb_ads_all_raw_account_ad_date_idx ON fb_ads_all_raw (account_id, ad_id, date);

-- ─── Chi tiêu theo adset × ngày ───
CREATE TABLE fb_adset_all (
    adset_id                        text,
    adset_name                      text,
    campaign_id                     text,
    campaign_name                   text,
    account_id                      text,
    account_name                    text,
    date                            date,
    spend                           double precision,
    impressions                     bigint,
    reach                           bigint,
    clicks                          bigint,
    cpm                             double precision,
    ctr                             double precision,
    cpc                             double precision,
    frequency                       double precision,
    purchases                       bigint,
    purchase_value                  double precision,
    leads                           bigint,
    messaging_conversations_started bigint,
    project_id                      text,
    sync_time                       text
);
CREATE TABLE fb_adset_all_raw (LIKE fb_adset_all);
CREATE INDEX fb_adset_all_date_idx ON fb_adset_all (date);
CREATE INDEX fb_adset_all_raw_account_adset_date_idx ON fb_adset_all_raw (account_id, adset_id, date);

-- ─── Ngân sách campaign (ghi đè cả bảng mỗi vòng; tiền theo đơn vị của TKQC — campaign_sync.py) ───
CREATE TABLE fb_campaign_all (
    campaign_id      text,
    campaign_name    text,
    status           text,
    effective_status text,
    daily_budget     double precision,
    lifetime_budget  double precision,
    budget_remaining double precision,
    objective        text,
    start_time       text,
    stop_time        text,
    account_id       text,
    sync_time        text
);

-- ─── Từ điển ad_id lạ trên đơn (X9, chỉ ghi thêm) ───
CREATE TABLE ad_dictionary (
    ad_id         text,
    account_id    text,
    account_name  text,
    campaign_id   text,
    campaign_name text,
    ad_name       text,
    status        text,
    sync_time     text
);
CREATE INDEX ad_dictionary_ad_id_idx ON ad_dictionary (ad_id);

-- ─── Bảng đơn của đối tác 3PL (Google Sheet, ghi đè cả bảng mỗi vòng) ───
CREATE TABLE partner_orders (
    market          text,
    shop_label      text,
    sheet_id        text,
    row_no          bigint,
    marketer        text,
    recon           text,
    note            text,
    status          text,
    order_date      date,
    ship_date       date,
    ship_method     text,
    order_no        text,
    tracking        text,
    return_order_no text,
    sku             text,
    quantity        bigint,
    contact_name    text,
    phone           text,
    country         text,
    state           text,
    city            text,
    address         text,
    postcode        text,
    cod             double precision,
    currency        text,
    synced_at       timestamptz
);

-- ─── Danh bạ TKQC tự động — mỗi vòng sync hỏi Meta mọi token thấy TKQC nào (sync/core/ad_accounts.py) ───
CREATE TABLE ad_accounts (
    account_id     text PRIMARY KEY,                 -- số trần, không có "act_" (như account_id của chi tiêu)
    name           text,
    account_status integer,                          -- account_status của Meta: 1 đang chạy, 2 vô hiệu hoá, 3 nợ…
    currency       text,
    timezone_name  text,                             -- ngày của chi tiêu tính theo múi giờ này
    category       text NOT NULL,                    -- talpha_rules.json → ad_account_categories (antalo, seed, other)
    is_confirmed   boolean NOT NULL DEFAULT false,   -- người đã xem / gán loại ở /admin → TKQC
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now(),   -- lần cuối token còn thấy TKQC này
    note           text,
    token_env_var  text                              -- token ĐẦU TIÊN thấy TKQC (TALPHA_META_ACCESS_TOKEN, _2, _3)
);


-- ═══ 2. Hàm dùng chung cho câu SQL ══════════════════════════════════════════════════════
-- Câu SQL của dashboard, view và báo cáo viết trên BigQuery từ đầu. Mấy hàm dưới giữ ĐÚNG nghĩa cũ ở
-- những chỗ Postgres khác BigQuery mà khác thì ra số sai chứ không báo lỗi.

-- Chia luôn ra số thực, mẫu 0 / NULL thì NULL (như SAFE_DIVIDE). Postgres chia hai số nguyên là chia
-- nguyên — 3/4 = 0 — nên tỷ lệ % viết bằng dấu / trần sẽ ra 0 mà không ai thấy.
CREATE FUNCTION safe_divide(a double precision, b double precision) RETURNS double precision
    LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN b = 0 THEN NULL ELSE a / b END $$;

-- ROUND(số thực, n) — Postgres chỉ có ROUND(numeric, n); số thực thì báo "function does not exist".
CREATE FUNCTION round(x double precision, n integer) RETURNS double precision
    LANGUAGE sql IMMUTABLE AS $$ SELECT round(x::numeric, n)::double precision $$;

-- Chuỗi giờ POS ("2026-11-01T03:12:45.123", giờ UTC) → timestamp. Sai dạng → NULL, không làm chết cả
-- câu (như SAFE.PARSE_TIMESTAMP).
CREATE FUNCTION safe_ts(s text) RETURNS timestamp LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF s IS NULL OR btrim(s) = '' THEN RETURN NULL; END IF;
    RETURN replace(btrim(s), ' ', 'T')::timestamp;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

-- Ngày của một giờ UTC (chuỗi POS) theo múi giờ tz — như DATE(TIMESTAMP(s), tz).
CREATE FUNCTION date_in_tz(s text, tz text) RETURNS date LANGUAGE sql STABLE AS $$
    SELECT ((safe_ts(s) AT TIME ZONE 'UTC') AT TIME ZONE tz)::date $$;

-- Chuỗi JSON → jsonb, hỏng → NULL (như JSON_EXTRACT_SCALAR gặp chuỗi không phải JSON).
CREATE FUNCTION safe_json(s text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN s::jsonb;
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;


-- ═══ 3. Bảng phụ của sync / báo cáo ═════════════════════════════════════════════════════

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
CREATE INDEX product_catalog_variation_idx ON product_catalog (variation_id);

-- ─── Ảnh chụp tồn kho — đường dự phòng của tab Kho khi POS chết (/api/talpha/sync-inventory) ───
CREATE TABLE inventory_snapshot (
    snapshot_time timestamptz NOT NULL,
    source        text,
    payload       text
);
CREATE INDEX inventory_snapshot_time_idx ON inventory_snapshot (snapshot_time DESC);

-- ─── Sức khoẻ vòng chạy (report_health.py) — bot Zalo đọc qua /api/talpha/sync-health ───
CREATE TABLE sync_health (
    ts        timestamptz NOT NULL,
    host      text,
    ok        boolean,
    sync_rc   bigint,
    format_rc bigint,
    detail    text
);
CREATE INDEX sync_health_ts_idx ON sync_health (ts DESC);

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
CREATE INDEX sync_health_accounts_run_ts_idx ON sync_health_accounts (run_ts DESC);

-- ─── Số báo cáo tháng (format_all.py) — tab Tổng quan / P&L / Marketer và bot Zalo đọc từ đây ───
-- Mỗi dòng là MỘT tab của file "TỔNG TEAM THÁNG n", y hệt nội dung ghi lên Sheet: `rows` là mảng các hàng
-- (hàng đầu là tiêu đề, hàng cuối là TỔNG). Ghi đè trọn một tháng trong một transaction.
CREATE TABLE monthly_report_tabs (
    month      text        NOT NULL,          -- 'YYYY-MM'
    report_key text        NOT NULL,          -- 'tong_team'
    tab_order  integer     NOT NULL,          -- thứ tự tab như trên Sheet
    tab_name   text        NOT NULL,
    rows       jsonb       NOT NULL,
    written_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (month, report_key, tab_order)
);

-- ─── Vân tay bộ view — dựng lại view khi luật (tỷ giá, số chia, giá vốn…) đổi (sync/core/pg_view.py) ───
CREATE TABLE view_fingerprints (
    id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    fingerprint text        NOT NULL,
    built_at    timestamptz NOT NULL DEFAULT now()
);


-- ═══ 4. Dữ liệu người dùng nhập trên dashboard ═══════════════════════════════════════════
--   app_documents           sao kê COD, việc đối soát, thanh toán QC, vận đơn, chi phí vận hành — mỗi kho
--                           một dòng, nội dung jsonb (lib/talpha/store.ts)
--   market_overrides        nước thêm / sửa / tắt ở /admin → Thị trường, PHỦ lên talpha_rules.json
--   market_monthly_reports  số nước × người cho bot Zalo (/api/talpha/market-report)
--   users                   tài khoản đăng nhập (lib/users.ts)
--   api_credentials         token Meta, key POS, token Pancake, key 17TRACK, khoá Gemini — MÃ HOÁ bằng
--                           pgcrypto, chìa ở biến TALPHA_ENCRYPTION_KEY
--   file_imports            sổ "file cũ nào đã chép vào kho" (sync/core/file_import.py) — mỗi file một lần
-- Luật gốc config/talpha_rules.json VẪN ở git (có lịch sử, test chạy trên nó, view dựng từ nó).

-- pgp_sym_encrypt / pgp_sym_decrypt. Đặt ở schema public và gọi kèm tên schema (public.pgp_…): test chạy
-- migration trong schema tạm với search_path chỉ có schema đó.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Giải mã một khoá; chìa sai / dữ liệu hỏng → NULL. Gọi thẳng pgp_sym_decrypt trên cả bảng thì MỘT dòng mã hoá
-- bằng chìa khác làm chết cả câu → mọi khoá rơi về .env.local (cũ) ở cả dashboard lẫn sync.
CREATE FUNCTION safe_decrypt(data bytea, secret text) RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN public.pgp_sym_decrypt(data, secret);
EXCEPTION WHEN others THEN
    RETURN NULL;
END $$;

CREATE TABLE app_documents (
    name        text PRIMARY KEY CHECK (name ~ '^[A-Za-z0-9_-]+$'),
    content     jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market_overrides (
    market_key  text PRIMARY KEY,
    settings    jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);

CREATE TABLE market_monthly_reports (
    month       text PRIMARY KEY CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
    content     jsonb NOT NULL,
    written_at  timestamptz NOT NULL DEFAULT now()
);

-- username = tên đăng nhập ("loc", "thai"…), so không phân biệt hoa thường.
CREATE TABLE users (
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
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

-- name = tên biến môi trường của khoá (TALPHA_META_ACCESS_TOKEN, TALPHA_POSCAKE_SG_KEY…): code đọc khoá theo tên này.
CREATE TABLE api_credentials (
    name             text PRIMARY KEY CHECK (name ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
    encrypted_value  bytea NOT NULL,
    note             text,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    updated_by       text
);

CREATE TABLE file_imports (
    source       text PRIMARY KEY,
    imported_at  timestamptz NOT NULL DEFAULT now(),
    detail       text
);


-- ═══ 5. Việc nền + "Cập nhật ngay" ═══════════════════════════════════════════════════════
--   job_runs          sổ từng lượt việc nền (kéo số, dựng báo cáo…) — ops/docker/scheduler.py ghi qua
--                     sync/core/job_log.py; đèn "Cập nhật lúc…" trên dashboard đọc
--   refresh_requests  yêu cầu "Cập nhật ngay" bấm trên dashboard (/api/talpha/refresh); lịch nhặt và chạy

CREATE TABLE job_runs (
    id            bigserial PRIMARY KEY,
    job           text NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
    exit_code     integer,
    triggered_by  text,
    output_tail   text
);
CREATE INDEX job_runs_job_started_idx ON job_runs (job, started_at DESC);

CREATE TABLE refresh_requests (
    id            bigserial PRIMARY KEY,
    requested_by  text,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ok', 'failed'))
);
CREATE INDEX refresh_requests_status_idx ON refresh_requests (status, id);


-- ═══ 6. Vai CHỈ ĐỌC cho câu SQL không tin được ══════════════════════════════════════════
-- Câu SQL của 4 tab (Marketing, Sức khoẻ QC, Khách hàng, Market Intel) dựng ở trình duyệt, và câu do AI
-- viết ở "CEO hỏi" / Hỏi AI. Chạy bằng tài khoản chủ là đọc được cả file trên máy chủ (pg_read_file…).
-- Dashboard ĐĂNG NHẬP bằng một trong hai vai dưới (không SET ROLE: phiên của tài khoản quản trị đổi vai
-- được thì câu SQL cũng tự đổi về được bằng set_config('role', …)). Hai vai không là thành viên của vai
-- nào nên không có đường leo quyền. Mật khẩu đặt lúc migrate từ TALPHA_READONLY_PASSWORD (sync/core/pg.py):
--
--   talpha_readonly         đọc mọi bảng / view của dashboard TRỪ bảng riêng (giám đốc, người xem mọi nước)
--   talpha_readonly_market  CHỈ đọc 5 bảng / view mà lib/talpha/access-rules.ts → scopeQuery lọc được theo
--                           nước; bảng khác bị từ chối ngay ở database
--
-- Quyền trên view được cấp lại mỗi lần dựng view (sync/core/pg_view.py) vì dựng lại là xoá view cũ.
-- Vai là của cả máy Postgres, không riêng database — tạo nếu chưa có.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha_readonly') THEN
        CREATE ROLE talpha_readonly NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha_readonly_market') THEN
        CREATE ROLE talpha_readonly_market NOLOGIN;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO talpha_readonly, talpha_readonly_market', current_schema());
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO talpha_readonly', current_schema());
    EXECUTE format('GRANT SELECT ON %I.sale_order, %I.order_items TO talpha_readonly_market',
                   current_schema(), current_schema());
END $$;

-- Bảng riêng: mật khẩu, khoá kết nối, sao kê tiền — hai vai chỉ đọc KHÔNG được thấy. Cùng danh sách
-- PRIVATE_TABLES ở sync/core/pg_view.py (dựng view cấp lại SELECT mọi bảng rồi REVOKE lại đúng danh sách
-- này). Thêm bảng riêng mới thì thêm vào CẢ hai chỗ.
REVOKE ALL ON app_documents, market_overrides, market_monthly_reports, users, api_credentials, file_imports
    FROM talpha_readonly, talpha_readonly_market;
