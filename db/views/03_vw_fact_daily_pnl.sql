-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 03 · vw_fact_daily_pnl  (LỚP 1: DAILY FACT)
-- ═══════════════════════════════════════════════════════════════════
-- P&L cấp PROJECT theo ngày (toàn bộ 7 shop GCC + Taiwan gộp lại).
-- Là nguồn cho vw_daily_momentum.
--
--   • DUAL REVENUE (COD): provisional (đơn hợp lệ) vs confirmed (đã giao)
--   • net_profit = confirmed_revenue − ads_spend − phí − COGS
--   • Early signals cho mô hình chat-sale: cost_per_msg, cost_per_lead
--
-- ⚠️ ĐƠN VỊ: mọi cột tiền = VND. Doanh thu/phí quy VND theo shop_label
--    trong vw_orders_std; ads_spend từ Meta đã là VND (rule CEO —
--    docs/TALPHA_METRIC_RULES.md) → cùng đơn vị, ROAS/net_profit có nghĩa.
--
-- ▸ G2 — `ads_spend` NAY ĐÃ LOẠI CAMPAIGN TEST (rule CEO §7: campaign chứa từ
--   "test" đứng riêng phải tách khỏi mọi báo cáo doanh số). Trước G2 view này
--   cộng cả chi tiêu test vào ads_spend nên ROAS, CPA và net_profit của TOÀN
--   PROJECT đều bị kéo xuống. Đo 10/08/2026: 59 quảng cáo test tiêu 23,8tr
--   trong 7 ngày. Chi tiêu test không biến mất — nó nằm ở cột `ads_spend_test`
--   riêng để vẫn đối soát được tổng với hoá đơn Meta:
--       ads_spend + ads_spend_test = tổng chi tiêu Meta của ngày.
--
-- ▸ G2 — CẢNH BÁO ĐỘ TIN CẬY ĐI KÈM SỐ, không rơi mất khi cuộn lên ngày.
--   vw_orders_std tính rất kỹ `cogs_coverage` cho từng đơn rồi view này lại
--   cộng cogs như thể đã khai đủ ⇒ `net_profit` trông chắc chắn trong khi giá
--   vốn mới phủ một phần. Nay có `cogs_coverage_wavg` (bình quân theo doanh thu
--   đã giao) và cờ `net_profit_reliable`. KHÔNG đưa net_profit ra quyết định
--   khi cờ này FALSE — khai thêm giá vốn trước (X3).
--
-- Nguồn: vw_orders_std + vw_fb_ads_std
-- ═══════════════════════════════════════════════════════════════════

CREATE VIEW vw_fact_daily_pnl AS
WITH ord AS (
    SELECT
        order_date                                          AS report_date,
        COUNT(*) FILTER (WHERE is_valid)                                   AS total_orders,
        COUNT(*) FILTER (WHERE is_confirmed)                               AS success_orders,
        COUNT(*) FILTER (WHERE is_returned)                                AS returned_orders,
        SUM(CASE WHEN is_valid THEN revenue_vnd ELSE 0 END)               AS provisional_revenue,
        SUM(CASE WHEN is_confirmed THEN revenue_vnd ELSE 0 END)               AS confirmed_revenue,
        SUM(CASE WHEN is_confirmed THEN cogs_vnd ELSE 0 END)                  AS confirmed_cogs,
        SUM(CASE WHEN is_valid THEN shipping_fee_vnd ELSE 0 END)          AS shipping_fee,
        SUM(CASE WHEN is_valid THEN partner_fee_vnd ELSE 0 END)           AS partner_fee,
        SUM(CASE WHEN is_returned THEN return_fee_vnd ELSE 0 END)            AS return_fee,

        -- ─── G2: cảnh báo độ tin cậy, mang lên cùng số ───
        -- Độ phủ giá vốn bình quân THEO DOANH THU ĐÃ GIAO (không phải theo số
        -- đơn): 1 đơn to chưa khai giá vốn hại hơn 10 đơn nhỏ đã khai.
        safe_divide(
            SUM(CASE WHEN is_confirmed THEN revenue_vnd * COALESCE(cogs_coverage, 0) ELSE 0 END),
            NULLIF(SUM(CASE WHEN is_confirmed THEN revenue_vnd ELSE 0 END), 0)
        )                                                   AS cogs_coverage_wavg,
        -- Đơn thuộc market chưa khai tỷ giá ⇒ mọi cột tiền của đơn đó sai.
        COUNT(*) FILTER (WHERE is_valid AND NOT is_fx_known)               AS orders_fx_unknown
    FROM vw_orders_std
    WHERE order_date >= (CURRENT_DATE - 90)
    GROUP BY report_date
),
ads AS (
    SELECT
        date                                                AS report_date,
        -- Chi tiêu THẬT: đã loại campaign test (rule CEO §7). Cờ is_test_campaign
        -- lấy từ vw_fb_ads_std — một định nghĩa duy nhất cho mọi view.
        SUM(CASE WHEN NOT is_test_campaign THEN spend ELSE 0 END)             AS ads_spend,
        SUM(CASE WHEN is_test_campaign THEN spend ELSE 0 END)             AS ads_spend_test,
        SUM(impressions)                                    AS impressions,
        SUM(reach)                                          AS reach,
        SUM(clicks)                                         AS clicks,
        SUM(messages)                                       AS total_messages,
        SUM(leads)                                          AS total_leads,
        ROUND(AVG(NULLIF(cpm, 0)), 2)                       AS avg_cpm,
        safe_divide(SUM(clicks), NULLIF(SUM(impressions), 0)) AS ctr,
        safe_divide(SUM(impressions), NULLIF(SUM(reach), 0))  AS frequency
    FROM vw_fb_ads_std
    WHERE date >= (CURRENT_DATE - 90)
    GROUP BY report_date
)
SELECT
    COALESCE(o.report_date, a.report_date)                  AS report_date,

    -- ─── Orders ───
    COALESCE(o.total_orders, 0)                             AS total_orders,
    COALESCE(o.success_orders, 0)                           AS success_orders,
    COALESCE(o.returned_orders, 0)                          AS returned_orders,
    ROUND(safe_divide(o.success_orders, NULLIF(o.total_orders, 0)) * 100, 1) AS success_rate_pct,
    ROUND(safe_divide(o.returned_orders, NULLIF(o.total_orders, 0)) * 100, 1) AS return_rate_pct,

    -- ─── Dual revenue (VND) ───
    COALESCE(o.provisional_revenue, 0)                      AS provisional_revenue,
    COALESCE(o.confirmed_revenue, 0)                        AS confirmed_revenue,

    -- ─── Spend & cost (VND) ───
    -- ads_spend ĐÃ LOẠI campaign test; cộng với ads_spend_test mới ra tổng hoá đơn Meta.
    COALESCE(a.ads_spend, 0)                                AS ads_spend,
    COALESCE(a.ads_spend_test, 0)                           AS ads_spend_test,
    COALESCE(o.confirmed_cogs, 0)                           AS confirmed_cogs,
    COALESCE(o.shipping_fee, 0)                             AS shipping_fee,
    COALESCE(o.partner_fee, 0)                              AS partner_fee,
    COALESCE(o.return_fee, 0)                               AS return_fee,

    -- ─── Net profit ───
    ROUND(
        COALESCE(o.confirmed_revenue, 0)
        - COALESCE(a.ads_spend, 0)
        - COALESCE(o.confirmed_cogs, 0)
        - COALESCE(o.shipping_fee, 0)
        - COALESCE(o.partner_fee, 0)
        - COALESCE(o.return_fee, 0)
    , 2)                                                    AS net_profit,

    -- ─── CPA (theo đơn giao thành công) ───
    ROUND(safe_divide(a.ads_spend, NULLIF(o.success_orders, 0)), 2) AS cpa,

    -- ─── Dual ROAS ───
    ROUND(safe_divide(o.provisional_revenue, NULLIF(a.ads_spend, 0)), 2) AS provisional_roas,
    ROUND(safe_divide(o.confirmed_revenue,   NULLIF(a.ads_spend, 0)), 2) AS confirmed_roas,

    -- ─── Early signals (chat-sale) ───
    COALESCE(a.total_messages, 0)                          AS total_messages,
    COALESCE(a.total_leads, 0)                             AS total_leads,
    ROUND(safe_divide(a.ads_spend, NULLIF(a.total_messages, 0)), 2) AS cost_per_mess,
    ROUND(safe_divide(a.ads_spend, NULLIF(a.total_leads, 0)), 2)    AS cost_per_lead,

    -- ─── Ads efficiency ───
    COALESCE(a.avg_cpm, 0)                                 AS avg_cpm,
    -- avg_ctr là PHÂN SỐ (clicks/impressions), KHÔNG phải % của Meta — xem
    -- ghi chú hai đơn vị CTR trong 01_vw_fb_ads_std.sql.
    ROUND(COALESCE(a.ctr, 0), 4)                           AS avg_ctr,
    ROUND(COALESCE(a.frequency, 0), 2)                     AS avg_frequency,

    -- ─── G2: độ tin cậy của chính dòng này ───
    -- Đọc net_profit thì PHẢI đọc kèm 2 cột dưới. Chúng không sửa số, chúng
    -- nói cho biết số đáng tin đến đâu.
    ROUND(COALESCE(o.cogs_coverage_wavg, 0), 4)            AS cogs_coverage_wavg,
    COALESCE(o.orders_fx_unknown, 0)                       AS orders_fx_unknown,
    (
        COALESCE(o.cogs_coverage_wavg, 0) >= {TH_COGS_COVERAGE_MIN_TRUST}
        AND COALESCE(o.orders_fx_unknown, 0) = 0
    )                                                      AS net_profit_reliable
FROM ord o
FULL OUTER JOIN ads a ON o.report_date = a.report_date;

