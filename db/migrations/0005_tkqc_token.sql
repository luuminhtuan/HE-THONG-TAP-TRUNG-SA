-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0005 — nhiều token Meta (04/11/2026)
--
-- TKQC nằm ở nhiều Business Manager / app (app mới "BÁO CÁO ANTALO SỸ ANH" thấy TK đang chạy, app cũ
-- "Dashboard Sỹ Anh Ngoài" thấy TK của BM cũ — chi tiêu tháng 9, 10). Khoá kết nối nhận tới 3 token:
-- TALPHA_META_ACCESS_TOKEN, _2, _3. Mỗi TKQC đọc bằng token ĐẦU TIÊN (theo thứ tự đó) thấy nó; cột này
-- ghi tên biến của token đó để Ads Command Center gọi Meta sống đúng token.
-- ═══════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE tkqc ADD COLUMN bien_token text;
