-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0003 — vai CHỈ ĐỌC cho cổng SQL /api/query (04/11/2026)
--
-- Câu SQL của 4 tab (Marketing, Sức khoẻ QC, Khách hàng, Market Intel) dựng ở trình duyệt nên
-- KHÔNG tin được. Trên BigQuery, tệ nhất là đọc được dataset; trên Postgres, chạy bằng tài khoản
-- chủ (quyền quản trị) thì đọc được cả file trên máy chủ (pg_read_file…). Route ĐĂNG NHẬP bằng
-- một trong hai vai dưới (không phải SET ROLE: phiên của tài khoản quản trị đổi vai được thì câu
-- SQL cũng tự đổi về được bằng set_config('role', …)). Hai vai không là thành viên của vai nào,
-- nên không có đường leo quyền. Mật khẩu đặt lúc migrate từ TALPHA_DOC_PASSWORD (sync/core/pg.py):
--
--   talpha_doc       — đọc mọi bảng / view của dashboard (giám đốc, người xem mọi nước)
--   talpha_doc_nuoc  — CHỈ đọc 5 bảng / view mà lib/talpha/access-rules.ts → scopeQuery lọc được
--                      theo nước; bảng khác (bảng _raw, báo cáo tháng…) bị từ chối ngay ở database
--
-- Quyền trên view được cấp lại mỗi lần dựng view (sync/core/pg_view.py) vì dựng lại là xoá view cũ.
-- Vai là của cả máy Postgres, không riêng database — tạo nếu chưa có.
-- ═══════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha_doc') THEN
        CREATE ROLE talpha_doc NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha_doc_nuoc') THEN
        CREATE ROLE talpha_doc_nuoc NOLOGIN;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO talpha_doc, talpha_doc_nuoc', current_schema());
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO talpha_doc', current_schema());
    EXECUTE format('GRANT SELECT ON %I.sale_order, %I.order_items TO talpha_doc_nuoc',
                   current_schema(), current_schema());
END $$;
