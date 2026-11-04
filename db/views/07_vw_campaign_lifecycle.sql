-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 07 · vw_campaign_lifecycle  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- BCG Matrix ở cấp CAMPAIGN (TALPHA chưa có product-mapping ổn định để
-- chạy ở cấp sản phẩm — xem README). Dựa trên CONFIRMED ROAS (đơn POS
-- giao thành công), KHÔNG dùng doanh thu Meta báo về.
--
--   ⭐ STAR      → SCALE     (ROAS ≥ roas_excellent + UPTREND + qua learning)
--   🐄 CASH_COW  → MAINTAIN  (ROAS ≥ roas_target + ổn định + mature)
--   🐕 DOG       → KILL      (ROAS < roas_danger + DOWNTREND + đủ già)
--   ❓ QUESTION  → MONITOR   (còn non hoặc lưng chừng)
--
-- scale_eligible = TRUE chỉ khi thoả ĐỒNG THỜI: ROAS≥3 + UPTREND +
--   ≥7 ngày + success_rate≥70% + KHÔNG phantom revenue.
--
-- ▸ G2 — NGƯỠNG KHÔNG CÒN Ở FILE NÀY. Tất cả lấy từ config/talpha_rules.json
--   → `thresholds` (roas_excellent / roas_target / roas_danger / days_active_*
--   / success_rate_scale_min / phantom_revenue_ratio). Muốn chỉnh theo biên lợi
--   nhuận GCC thì sửa rules file rồi deploy lại view — sửa ở đây là quay về
--   đúng cái bệnh "mỗi view một ngưỡng" mà G2 sinh ra để chữa.
--
-- ▸ G2 — `is_test_campaign` là CỜ, view không tự lọc. Campaign test vẫn được
--   chấm BCG (đôi khi cần biết campaign test đang ra sao) nhưng tab xếp hạng
--   phải lọc nó ra, nếu không campaign test lọt vào danh sách SCALE.
--
-- Nguồn: vw_orders_std + vw_fb_ads_std
-- ═══════════════════════════════════════════════════════════════════

CREATE VIEW vw_campaign_lifecycle AS
WITH
ad_to_campaign AS (
    SELECT ad_id, ANY_VALUE(campaign_id) AS campaign_id, ANY_VALUE(campaign_name) AS campaign_name
    FROM vw_fb_ads_std
    WHERE ad_id IS NOT NULL
    GROUP BY ad_id
),
adset_to_campaign AS (
    SELECT adset_id, ANY_VALUE(campaign_id) AS campaign_id
    FROM vw_fb_ads_std
    WHERE adset_id IS NOT NULL
    GROUP BY adset_id
),
-- Doanh thu/đơn theo campaign × ngày (từ orders, attribution)
orders_campaign AS (
    SELECT
        o.order_date                                        AS report_date,
        COALESCE(ac.campaign_id, asc2.campaign_id)          AS campaign_id,
        COUNT(*) FILTER (WHERE o.is_valid)                                 AS total_orders,
        COUNT(*) FILTER (WHERE o.is_confirmed)                             AS success_orders,
        SUM(CASE WHEN o.is_confirmed THEN o.revenue_vnd ELSE 0 END)           AS confirmed_revenue,
        SUM(CASE WHEN o.is_valid THEN o.revenue_vnd ELSE 0 END)           AS provisional_revenue
    FROM vw_orders_std o
    LEFT JOIN ad_to_campaign    ac   ON o.resolved_ad_id    = ac.ad_id
    LEFT JOIN adset_to_campaign asc2 ON o.resolved_adset_id = asc2.adset_id
    WHERE o.order_date >= (CURRENT_DATE - 30)
    GROUP BY 1, 2
),
-- Spend theo campaign × ngày
ads_campaign AS (
    SELECT
        date                                                AS report_date,
        campaign_id,
        ANY_VALUE(campaign_name)                            AS campaign_name,
        SUM(spend)                                          AS spend,
        bool_or(is_test_campaign)                        AS is_test_campaign
    FROM vw_fb_ads_std
    WHERE date >= (CURRENT_DATE - 30)
    GROUP BY report_date, campaign_id
),
-- Gộp ngày
daily AS (
    SELECT
        COALESCE(a.report_date, o.report_date)              AS report_date,
        COALESCE(a.campaign_id, o.campaign_id)              AS campaign_id,
        a.campaign_name,
        COALESCE(a.is_test_campaign, FALSE)                 AS is_test_campaign,
        COALESCE(a.spend, 0)                                AS spend,
        COALESCE(o.confirmed_revenue, 0)                    AS confirmed_revenue,
        COALESCE(o.provisional_revenue, 0)                  AS provisional_revenue,
        COALESCE(o.success_orders, 0)                       AS success_orders,
        COALESCE(o.total_orders, 0)                         AS total_orders,
        safe_divide(COALESCE(o.confirmed_revenue, 0),   NULLIF(a.spend, 0)) AS confirmed_roas,
        safe_divide(COALESCE(o.provisional_revenue, 0), NULLIF(a.spend, 0)) AS provisional_roas
    FROM ads_campaign a
    FULL OUTER JOIN orders_campaign o
        ON a.report_date = o.report_date AND a.campaign_id = o.campaign_id
    WHERE COALESCE(a.campaign_id, o.campaign_id) IS NOT NULL
),
metrics AS (
    SELECT
        campaign_id,
        ANY_VALUE(campaign_name)                            AS campaign_name,
        -- Cờ, KHÔNG lọc — tab xếp hạng phải tự loại trước khi ra danh sách SCALE.
        bool_or(is_test_campaign)                        AS is_test_campaign,
        COUNT(DISTINCT CASE WHEN spend > 0 THEN report_date ELSE NULL END)    AS days_active,
        ROUND(AVG(CASE WHEN report_date >= (CURRENT_DATE - 7) THEN confirmed_roas ELSE NULL END), 2) AS confirmed_roas_ma7,
        ROUND(AVG(CASE WHEN report_date >= (CURRENT_DATE - 3) THEN confirmed_roas ELSE NULL END), 2) AS confirmed_roas_ma3,
        ROUND(AVG(CASE WHEN report_date >= (CURRENT_DATE - 7) THEN provisional_roas ELSE NULL END), 2) AS provisional_roas_ma7,
        SUM(CASE WHEN report_date >= (CURRENT_DATE - 7) THEN spend ELSE 0 END)             AS spend_7d,
        SUM(CASE WHEN report_date >= (CURRENT_DATE - 7) THEN confirmed_revenue ELSE 0 END) AS confirmed_revenue_7d,
        safe_divide(
            SUM(CASE WHEN report_date >= (CURRENT_DATE - 7) THEN success_orders ELSE 0 END),
            NULLIF(SUM(CASE WHEN report_date >= (CURRENT_DATE - 7) THEN total_orders ELSE 0 END), 0)
        ) * 100                                             AS success_rate_7d
    FROM daily
    GROUP BY campaign_id
)
SELECT
    m.*,

    -- ═══ MOMENTUM ═══
    CASE
        WHEN confirmed_roas_ma3 > confirmed_roas_ma7        THEN 'UPTREND'
        WHEN confirmed_roas_ma3 < confirmed_roas_ma7 * {TH_MOMENTUM_DOWN_RATIO} THEN 'DOWNTREND'
        ELSE 'STABLE'
    END                                                    AS confirmed_roas_momentum,

    -- ═══ BCG STAGE ═══
    CASE
        WHEN confirmed_roas_ma7 >= {TH_ROAS_EXCELLENT} AND confirmed_roas_ma3 > confirmed_roas_ma7 AND days_active >= {TH_DAYS_ACTIVE_STAR}  THEN 'STAR'
        WHEN confirmed_roas_ma7 >= {TH_ROAS_TARGET} AND confirmed_roas_ma3 >= confirmed_roas_ma7 * {TH_MOMENTUM_DOWN_RATIO} AND days_active >= {TH_DAYS_ACTIVE_MATURE} THEN 'CASH_COW'
        WHEN confirmed_roas_ma7 < {TH_ROAS_DANGER}  AND confirmed_roas_ma3 < confirmed_roas_ma7 * {TH_MOMENTUM_DOWN_RATIO} AND days_active >= {TH_DAYS_ACTIVE_DOG}  THEN 'DOG'
        ELSE 'QUESTION_MARK'
    END                                                    AS bcg_stage,

    -- ═══ RECOMMENDED ACTION ═══
    CASE
        WHEN confirmed_roas_ma7 >= {TH_ROAS_EXCELLENT} AND confirmed_roas_ma3 > confirmed_roas_ma7
             AND days_active >= {TH_DAYS_ACTIVE_STAR} AND COALESCE(success_rate_7d, 0) >= {TH_SUCCESS_RATE_SCALE_MIN} THEN 'SCALE'
        WHEN confirmed_roas_ma7 >= {TH_ROAS_TARGET} AND days_active >= {TH_DAYS_ACTIVE_MATURE}            THEN 'MAINTAIN'
        WHEN days_active < {TH_DAYS_ACTIVE_STAR}                                            THEN 'LEARNING'
        WHEN confirmed_roas_ma7 < {TH_ROAS_DANGER} AND days_active >= {TH_DAYS_ACTIVE_DOG}             THEN 'KILL'
        ELSE 'MONITOR'
    END                                                    AS recommended_action,

    -- ═══ PHANTOM REVENUE WARNING ═══
    (provisional_roas_ma7 > confirmed_roas_ma7 * {TH_PHANTOM_REVENUE_RATIO})      AS phantom_revenue_warning,

    -- ═══ SCALE ELIGIBILITY (chặt) ═══
    (
        confirmed_roas_ma7 >= {TH_ROAS_EXCELLENT}
        AND confirmed_roas_ma3 > confirmed_roas_ma7
        AND days_active >= {TH_DAYS_ACTIVE_STAR}
        AND COALESCE(success_rate_7d, 0) >= {TH_SUCCESS_RATE_SCALE_MIN}
        AND (provisional_roas_ma7 <= confirmed_roas_ma7 * {TH_PHANTOM_REVENUE_RATIO} OR provisional_roas_ma7 IS NULL)
    )                                                      AS scale_eligible

FROM metrics m
WHERE days_active >= 1;

