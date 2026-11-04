-- ═══════════════════════════════════════════════════════════════════
-- TALPHA Analytics — 12 · vw_product_pnl
-- ═══════════════════════════════════════════════════════════════════
-- Doanh thu theo SẢN PHẨM: doanh thu đơn đã giao (vw_orders_std, đã quy VND theo nước) chia cho
-- từng dòng hàng theo số lượng, gom theo sku ĐÃ CHUẨN HOÁ (vw_product_catalog_std — "008" và
-- "Necklace box" là một). Trước 04/11/2026 view này do sync_product_catalog.py dựng riêng.
--
-- Khoá (shop_id, order_id): mỗi shop POS đánh số đơn riêng, nối mỗi order_id là cộng doanh thu
-- đơn 18 của Đài với đơn 18 của Sing.
-- ═══════════════════════════════════════════════════════════════════

CREATE VIEW vw_product_pnl AS
WITH item_rev AS (
    SELECT
        i.shop_id,
        i.order_id,
        i.variation_id,
        i.quantity,
        v.shop_label,
        v.order_date,
        v.revenue_vnd * safe_divide(
            i.quantity, SUM(i.quantity) OVER (PARTITION BY i.shop_id, i.order_id)
        ) AS revenue_vnd
    FROM order_items i
    JOIN vw_orders_std v
      ON i.shop_id = v.shop_id AND i.order_id = v.order_id
    WHERE v.is_confirmed
)
SELECT
    c.sku,
    c.sku_code,
    ANY_VALUE(c.product_name)     AS product_name,
    ir.shop_label,
    COUNT(DISTINCT CONCAT(ir.shop_id, '-', ir.order_id)) AS orders,
    SUM(ir.quantity)              AS units,
    ROUND(SUM(ir.revenue_vnd), 0) AS revenue_vnd
FROM item_rev ir
JOIN vw_product_catalog_std c
  ON ir.variation_id = c.variation_id
GROUP BY c.sku, c.sku_code, ir.shop_label;
