-- ═══════════════════════════════════════════════════════════════════
-- fb_adset_data — chi tiêu của các TKQC thuộc loại VÀO BÁO CÁO (04/11/2026)
-- ═══════════════════════════════════════════════════════════════════
-- Sync kéo chi tiêu của MỌI TKQC token đọc được vào fb_adset_tat_ca. View này chỉ giữ TKQC có loại
-- vao_bao_cao = true (talpha_rules.json → tkqc_loai; loại từng TKQC ở bảng tkqc, đổi ở /admin → TKQC).
-- Mọi chỗ đọc fb_adset_data — dashboard, báo cáo tháng, bot, view phân tích — tự bỏ TKQC ngoài báo cáo.
-- TKQC chưa có trong bảng tkqc (chưa vòng sync nào thấy) tính theo loại mặc định.
-- ═══════════════════════════════════════════════════════════════════

CREATE VIEW fb_adset_data AS
SELECT f.*
FROM fb_adset_tat_ca f
LEFT JOIN tkqc t ON t.account_id = f.account_id
WHERE COALESCE(t.loai, '{TKQC_MAC_DINH}') IN ({TKQC_VAO_BAO_CAO});
