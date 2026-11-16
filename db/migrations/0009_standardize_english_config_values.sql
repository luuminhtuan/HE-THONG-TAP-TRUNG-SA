-- 0009 (16/11/2026): giá trị cấu hình tiếng Việt trong DỮ LIỆU đã lưu → tiếng Anh, khớp config/talpha_rules.json
-- cùng đợt (markets.*.status, markets.*.owner, ad_account_categories).
--
-- Chỉ đổi đúng các giá trị/khoá đã biết; giá trị lạ để nguyên. Chạy lại không làm gì thêm.

-- Phần phủ thị trường nhập ở /admin → Thị trường (bảng market_overrides, cột settings jsonb):
--   status: dang_ban / sap_chay / da_tat → active / upcoming / disabled
UPDATE market_overrides
SET settings = jsonb_set(settings, '{status}', to_jsonb(CASE settings->>'status'
        WHEN 'dang_ban' THEN 'active' WHEN 'sap_chay' THEN 'upcoming' WHEN 'da_tat' THEN 'disabled' END))
WHERE settings->>'status' IN ('dang_ban', 'sap_chay', 'da_tat');

--   nguoi_cam (người cầm nước) → owner
UPDATE market_overrides
SET settings = (settings - 'nguoi_cam') || jsonb_build_object('owner', settings->'nguoi_cam')
WHERE settings ? 'nguoi_cam';

-- Loại của từng TKQC (/admin → TKQC): mã loại hat_giong / khac → seed / other (antalo giữ nguyên).
UPDATE ad_accounts SET category = 'seed'  WHERE category = 'hat_giong';
UPDATE ad_accounts SET category = 'other' WHERE category = 'khac';
