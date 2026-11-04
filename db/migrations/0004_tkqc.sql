-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0004 — danh bạ TKQC tự động + chi tiêu của MỌI TKQC (04/11/2026)
--
-- Trước: danh sách TKQC gõ tay ở config/projects/talpha.yaml — thêm TK mới là phải sửa file rồi deploy,
-- còn trang TKQC Manager ghi một file khác mà sync không đọc. Nay mỗi vòng sync hỏi Meta token thấy TKQC
-- nào (/me/adaccounts) → ghi vào bảng tkqc, kéo chi tiêu của TẤT CẢ.
--
-- Mỗi TKQC một LOẠI (talpha_rules.json → tkqc_loai). Chi tiêu của mọi TKQC nằm ở fb_ads_tat_ca;
-- fb_ads_data / fb_adset_data / fb_campaign_data thành VIEW chỉ gồm loại vao_bao_cao (db/views/00_fb_*.sql)
-- → dashboard, báo cáo tháng, bot, các view phân tích vẫn đọc tên cũ và tự đúng; đổi loại một TKQC ở
-- /admin → TKQC là có tác dụng ngay, không phải chạy lại gì.
-- ═══════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE fb_ads_data      RENAME TO fb_ads_tat_ca;
ALTER TABLE fb_ads_data_raw  RENAME TO fb_ads_tat_ca_raw;
ALTER TABLE fb_adset_data    RENAME TO fb_adset_tat_ca;
ALTER TABLE fb_adset_data_raw RENAME TO fb_adset_tat_ca_raw;
ALTER TABLE fb_campaign_data RENAME TO fb_campaign_tat_ca;

CREATE TABLE tkqc (
    account_id    text PRIMARY KEY,            -- số trần, không có "act_" (như cột account_id của chi tiêu)
    ten           text,
    trang_thai    integer,                     -- account_status của Meta: 1 đang chạy, 2 vô hiệu hoá, 3 nợ…
    tien_te       text,
    mui_gio       text,                        -- timezone_name của Meta — ngày của chi tiêu theo múi này
    loai          text NOT NULL,
    da_xac_nhan   boolean NOT NULL DEFAULT false,   -- người đã xem / gán loại trên trang
    thay_lan_dau  timestamptz NOT NULL DEFAULT now(),
    thay_lan_cuoi timestamptz NOT NULL DEFAULT now(),   -- lần cuối token còn thấy TKQC này
    ghi_chu       text
);
