-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0001 — bảng thô sync ghi mỗi giờ (04/11/2026)
--
-- Cột và kiểu chép đúng schema BigQuery trong sync/talpha/talpha_sync.py (ORDER_SCHEMA,
-- ITEM_SCHEMA, ADS_SCHEMA, ADSET_SCHEMA, CAMPAIGN_SCHEMA, PARTNER_ORDER_SCHEMA) — có test so.
-- Ngày giờ của đơn (inserted_at, updated_at, sync_time…) giữ dạng CHUỖI như BigQuery: luật chọn đơn
-- so chuỗi (bq_writer.chon_don_can_ghi) và câu SQL của dashboard cắt SUBSTR(inserted_at, 1, 10).
--
-- Hai tầng như BigQuery (bq_writer, X1/X2): <bảng>_raw chỉ GHI THÊM, không bao giờ xoá; bảng sạch
-- dựng lại từ raw mỗi vòng sync. Thêm cột thì thêm vào CẢ bảng sạch lẫn bảng _raw, bằng file
-- migration MỚI — đừng sửa file này, máy đã chạy nó sẽ không chạy lại.
--
-- Không khai khoá chính: BigQuery không ép ràng buộc, đơn thiếu mã mà làm hỏng cả vòng ghi là mất
-- số của mọi shop. Bảng sạch đã duy nhất theo khoá nhờ bước dựng lại (DISTINCT ON).
-- ═══════════════════════════════════════════════════════════════════════════════════════

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
CREATE INDEX sale_order_khoa ON sale_order (shop_id, id);
CREATE INDEX sale_order_ngay ON sale_order (inserted_at);
CREATE INDEX sale_order_raw_khoa ON sale_order_raw (shop_id, id);

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
CREATE INDEX order_items_don ON order_items (shop_id, order_id);
CREATE INDEX order_items_raw_don ON order_items_raw (shop_id, order_id, sync_time);

-- ─── Chi tiêu quảng cáo theo ad × ngày (spend đã là VND) ───
CREATE TABLE fb_ads_data (
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
CREATE TABLE fb_ads_data_raw (LIKE fb_ads_data);
CREATE INDEX fb_ads_data_ngay ON fb_ads_data (date);
CREATE INDEX fb_ads_data_raw_khoa ON fb_ads_data_raw (account_id, ad_id, date);

-- ─── Chi tiêu theo adset × ngày ───
CREATE TABLE fb_adset_data (
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
CREATE TABLE fb_adset_data_raw (LIKE fb_adset_data);
CREATE INDEX fb_adset_data_ngay ON fb_adset_data (date);
CREATE INDEX fb_adset_data_raw_khoa ON fb_adset_data_raw (account_id, adset_id, date);

-- ─── Ngân sách campaign (ghi đè cả bảng mỗi vòng) ───
CREATE TABLE fb_campaign_data (
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
CREATE INDEX ad_dictionary_ad ON ad_dictionary (ad_id);

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
