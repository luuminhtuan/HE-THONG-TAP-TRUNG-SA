-- 0008 (16/11/2026): đổi tên bảng / cột / hàm tiếng Việt sang tiếng Anh chuẩn.
--
-- CHỈ ĐỔI TÊN (ALTER … RENAME) — dữ liệu, khoá chính, chỉ mục, quyền giữ nguyên. View dựa trên các
-- bảng này tự theo tên mới (Postgres giữ tham chiếu theo OID); pg_view.py dựng lại view từ db/views
-- ngay sau migrate vì SQL view đã đổi.
--
-- Bảng schema_migrations (ten, chay_luc → name, applied_at) KHÔNG đổi ở đây: chính bộ chạy migration
-- ghi tên file vào bảng đó sau khi chạy file này — sync/core/pg.py tự đổi cột đó trước khi chạy.

-- Danh bạ TKQC
ALTER TABLE tkqc RENAME TO ad_accounts;
ALTER TABLE ad_accounts RENAME COLUMN ten           TO name;
ALTER TABLE ad_accounts RENAME COLUMN trang_thai    TO account_status;
ALTER TABLE ad_accounts RENAME COLUMN tien_te       TO currency;
ALTER TABLE ad_accounts RENAME COLUMN mui_gio       TO timezone_name;
ALTER TABLE ad_accounts RENAME COLUMN loai          TO category;
ALTER TABLE ad_accounts RENAME COLUMN da_xac_nhan   TO is_confirmed;
ALTER TABLE ad_accounts RENAME COLUMN thay_lan_dau  TO first_seen_at;
ALTER TABLE ad_accounts RENAME COLUMN thay_lan_cuoi TO last_seen_at;
ALTER TABLE ad_accounts RENAME COLUMN ghi_chu       TO note;
ALTER TABLE ad_accounts RENAME COLUMN bien_token    TO token_env_var;

-- Chi tiêu MỌI TKQC (fb_ads_data / fb_adset_data / fb_campaign_data vẫn là VIEW lọc TKQC vào báo cáo)
ALTER TABLE fb_ads_tat_ca       RENAME TO fb_ads_all;
ALTER TABLE fb_ads_tat_ca_raw   RENAME TO fb_ads_all_raw;
ALTER TABLE fb_adset_tat_ca     RENAME TO fb_adset_all;
ALTER TABLE fb_adset_tat_ca_raw RENAME TO fb_adset_all_raw;
ALTER TABLE fb_campaign_tat_ca  RENAME TO fb_campaign_all;

-- Số báo cáo tháng (format_all.py ghi, tab Tổng quan / P&L / Marketer + bot đọc)
ALTER TABLE bao_cao_tab RENAME TO monthly_report_tabs;
ALTER TABLE monthly_report_tabs RENAME COLUMN thang   TO month;
ALTER TABLE monthly_report_tabs RENAME COLUMN tep     TO report_key;
ALTER TABLE monthly_report_tabs RENAME COLUMN thu_tu  TO tab_order;
ALTER TABLE monthly_report_tabs RENAME COLUMN ten_tab TO tab_name;
ALTER TABLE monthly_report_tabs RENAME COLUMN hang    TO rows;
ALTER TABLE monthly_report_tabs RENAME COLUMN ghi_luc TO written_at;

-- Vân tay bộ view (pg_view.py)
ALTER TABLE view_van_tay RENAME TO view_fingerprints;
ALTER TABLE view_fingerprints RENAME COLUMN van_tay  TO fingerprint;
ALTER TABLE view_fingerprints RENAME COLUMN dung_luc TO built_at;

-- Ngày của một mốc giờ theo múi giờ (chi tiêu Meta theo múi của TKQC). ngay_theo_mui giữ lại làm bí danh
-- cho câu SQL cũ (CEO hỏi, câu tự gõ) — view mới chỉ dùng date_in_tz.
CREATE FUNCTION date_in_tz(s text, tz text) RETURNS date LANGUAGE sql STABLE AS $$
    SELECT ((safe_ts(s) AT TIME ZONE 'UTC') AT TIME ZONE tz)::date $$;

-- Dòng app_documents có tên tiếng Việt (nội dung jsonb giữ nguyên)
UPDATE app_documents SET name = 'ads_recon_rows'     WHERE name = 'ads_recon_kho';
UPDATE app_documents SET name = 'operating_expenses' WHERE name = 'chi_phi_van_hanh';

-- Vai CHỈ ĐỌC tên tiếng Anh. TẠO MỚI cạnh vai cũ (talpha_doc, talpha_doc_nuoc), KHÔNG đổi tên: vai là đối
-- tượng của cả cụm Postgres, đổi tên là mọi bản code cũ đang nối cùng cụm (và phép thử chạy migration
-- trong schema tạm) gãy ngay. pg.py đặt mật khẩu đăng nhập cho vai mới từ TALPHA_READONLY_PASSWORD; pg_view.py
-- cấp/thu quyền cho cả hai cặp. Vai cũ bỏ ở một migration sau, khi không còn bản nào dùng.
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

-- GRANT ALL TABLES ở trên gồm cả bảng RIÊNG (mật khẩu, khoá kết nối, sao kê tiền) — thu lại ngay, đúng danh
-- sách của migration 0006 (PRIVATE_TABLES ở sync/core/pg_view.py). Thiếu đoạn này là vai chỉ đọc của
-- /api/query và "CEO hỏi" đọc được api_credentials.
REVOKE ALL ON app_documents, market_overrides, market_monthly_reports, users, api_credentials, file_imports
    FROM talpha_readonly, talpha_readonly_market;
