-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 11 · vw_attribution_quality  (LỚP 2: INTELLIGENCE)
-- ═══════════════════════════════════════════════════════════════════
-- G1 — port từ STRAMARK_SalesOS.vw_attribution_quality (bản rút gọn).
-- Hệ TỰ ĐO chất lượng gán của chính mình, thay vì phải bóc tay mỗi lần
-- nghi ngờ (lỗi X9: 25,8% đơn không nối được campaign, phát hiện thủ công).
--
-- Hai chiều đo, mỗi chiều một mẫu số — ĐỌC KỸ MẪU SỐ trước khi trích số:
--   1. Chiều ĐƠN   : bao nhiêu % đơn hợp lệ gán được về quảng cáo.
--                    Mẫu số = đơn is_valid trong ngày (đã loại HUY/DON_THO).
--   2. Chiều TIỀN  : bao nhiêu % chi tiêu rơi vào quảng cáo CÓ ít nhất 1 đơn
--                    CÙNG NGÀY. Mẫu số = tổng spend trong ngày.
--
-- ▸ Chiều TIỀN thấp KHÔNG có nghĩa là lãng phí. Đơn thường về sau ngày chi
--   (COD, chat-sale kéo dài), nên chi hôm nay chưa có đơn hôm nay là bình
--   thường. Cột này để bắt XU HƯỚNG TỤT, không phải để kết tội một ngày.
--
-- ▸ Cột `orders_unknown_fx`: đơn thuộc market chưa khai tỷ giá — mọi số tiền
--   của các đơn đó KHÔNG tin được. Bình thường phải bằng 0.
--
-- ▸ Cửa sổ 60 ngày để nhìn được xu hướng chứ không chỉ hiện trạng.
--
-- Nguồn: vw_orders_std + vw_fb_ads_std
-- ═══════════════════════════════════════════════════════════════════

CREATE VIEW vw_attribution_quality AS
WITH known_ads AS (
    -- Mọi ad_id từng xuất hiện trong bảng ads, BẤT KỂ ngày. Dùng để tách hai
    -- kiểu "không nối được" vốn hay bị gộp làm một:
    --   • đơn KHÔNG CÓ ad_id                        → chat-sale/organic, bình thường
    --   • đơn CÓ ad_id nhưng ads KHÔNG TRẢ VỀ ad đó → lỗi X9 (ad bị xoá rồi tạo
    --     lại giữ id cũ, hoặc TKQC nằm ngoài roster 14 tài khoản)
    SELECT DISTINCT ad_id FROM vw_fb_ads_std
),
orders_by_day AS (
    SELECT
        o.order_date                                                        AS report_date,
        COUNT(DISTINCT o.order_uid)                                         AS valid_orders,
        COUNT(DISTINCT CASE WHEN o.resolved_ad_id IS NOT NULL THEN o.order_uid ELSE NULL END) AS orders_with_ad,
        -- X9: có ad_id nhưng bảng ads không hề có ad đó ⇒ vĩnh viễn không nối
        -- được vào chi phí. Khác hẳn đơn không có ad_id.
        COUNT(DISTINCT CASE WHEN o.resolved_ad_id IS NOT NULL AND a.ad_id IS NULL THEN o.order_uid ELSE NULL END)                               AS orders_unknown_ad,
        COUNT(DISTINCT CASE WHEN o.marketer_name != 'unknown' THEN o.order_uid ELSE NULL END)  AS orders_with_marketer,
        COUNT(DISTINCT CASE WHEN o.marketer_group = 'external' THEN o.order_uid ELSE NULL END) AS orders_external,
        COUNT(DISTINCT CASE WHEN NOT o.is_fx_known THEN o.order_uid ELSE NULL END)            AS orders_unknown_fx
    FROM vw_orders_std o
    LEFT JOIN known_ads a ON o.resolved_ad_id = a.ad_id
    WHERE o.is_valid
      AND o.order_date >= (CURRENT_DATE - 60)
    GROUP BY o.order_date
),
orders_by_ad_day AS (
    SELECT order_date AS report_date, resolved_ad_id AS ad_id,
           COUNT(DISTINCT order_uid) AS order_count
    FROM vw_orders_std
    WHERE is_valid AND resolved_ad_id IS NOT NULL
      AND order_date >= (CURRENT_DATE - 60)
    GROUP BY 1, 2
),
spend_by_ad_day AS (
    SELECT date AS report_date, ad_id, SUM(spend) AS spend
    FROM vw_fb_ads_std
    WHERE date >= (CURRENT_DATE - 60)
    GROUP BY 1, 2
),
spend_by_day AS (
    SELECT
        c.report_date,
        SUM(c.spend)                                    AS spend_vnd,
        SUM(CASE WHEN COALESCE(o.order_count, 0) > 0 THEN c.spend ELSE 0 END)       AS spend_with_same_day_orders,
        COUNT(DISTINCT c.ad_id)                         AS ads_with_spend,
        COUNT(DISTINCT CASE WHEN COALESCE(o.order_count, 0) > 0 THEN c.ad_id ELSE NULL END) AS ads_with_orders
    FROM spend_by_ad_day c
    LEFT JOIN orders_by_ad_day o USING (report_date, ad_id)
    GROUP BY c.report_date
)
SELECT
    COALESCE(d.report_date, c.report_date)                  AS report_date,

    -- ─── Chiều ĐƠN (mẫu số: đơn hợp lệ trong ngày) ───
    d.valid_orders,
    d.orders_with_ad,
    ROUND(100 * safe_divide(d.orders_with_ad, NULLIF(d.valid_orders, 0)), 1)      AS pct_orders_attributed,
    -- X9 — có ad_id mà bảng ads không có ad đó. Số này >0 nghĩa là đang mất
    -- đơn khỏi mọi phép tính CPO/ROAS theo quảng cáo, im lặng.
    d.orders_unknown_ad,
    ROUND(100 * safe_divide(d.orders_unknown_ad, NULLIF(d.orders_with_ad, 0)), 1)
                                                            AS pct_unknown_ad,
    d.orders_with_marketer,
    ROUND(100 * safe_divide(d.orders_with_marketer, NULLIF(d.valid_orders, 0)), 1) AS pct_orders_with_marketer,
    d.orders_external,
    d.orders_unknown_fx,

    -- ─── Chiều TIỀN (mẫu số: tổng chi trong ngày) ───
    ROUND(c.spend_vnd, 0)                                   AS spend_vnd,
    ROUND(c.spend_with_same_day_orders, 0)                      AS spend_with_same_day_orders,
    ROUND(100 * safe_divide(c.spend_with_same_day_orders, NULLIF(c.spend_vnd, 0)), 1)
                                                            AS pct_spend_with_same_day_orders,
    c.ads_with_spend,
    c.ads_with_orders
FROM orders_by_day d
FULL OUTER JOIN spend_by_day c ON d.report_date = c.report_date
ORDER BY report_date DESC;

