-- ═══════════════════════════════════════════════════════════════════
-- fb_ads_data — chi tiêu của các TKQC thuộc loại VÀO BÁO CÁO (04/11/2026)
-- ═══════════════════════════════════════════════════════════════════
-- Sync kéo chi tiêu của MỌI TKQC token đọc được vào fb_ads_all. View này chỉ giữ TKQC có loại
-- vao_bao_cao = true (talpha_rules.json → tkqc_loai; loại từng TKQC ở bảng ad_accounts, đổi ở /admin → TKQC).
-- Mọi chỗ đọc fb_ads_data — dashboard, báo cáo tháng, bot, view phân tích — tự bỏ TKQC ngoài báo cáo.
-- TKQC chưa có trong bảng ad_accounts (chưa vòng sync nào thấy) tính theo loại mặc định.
-- ═══════════════════════════════════════════════════════════════════

CREATE VIEW fb_ads_data AS
SELECT f.*
FROM fb_ads_all f
LEFT JOIN ad_accounts t ON t.account_id = f.account_id
WHERE COALESCE(t.category, '{AD_ACCOUNT_DEFAULT_CATEGORY}') IN ({AD_ACCOUNT_REPORT_CATEGORIES});
