---
paths:
  - "db/**/*.sql"
---
# Quy ước SQL — Postgres TALPHA

Luật an toàn dữ liệu và bẫy ra số sai: `postgres-data-rules.md` (đọc trước). File này chỉ là cách viết.

## Phương ngữ

- Postgres 17. Hàm giữ nghĩa cũ có sẵn: `safe_divide`, `safe_ts`, `safe_json`, `date_in_tz`.
- Viết lại câu cũ thời BigQuery thì theo bảng dịch trong `docs/POSTGRES.md`
  (`IFNULL` → `COALESCE`, `COUNTIF(c)` → `COUNT(*) FILTER (WHERE c)`, `x IN UNNEST(@ds)` → `x = ANY(@ds)`…).

## Migration (`db/migrations/`)

- Tên `NNNN_ten_tieng_anh.sql`, số kế tiếp. Mỗi file một transaction.
- Chỉ THÊM file. Không sửa, không đổi tên file đã chạy.
- Bảng hai tầng (đơn, dòng hàng, quảng cáo): thêm cột thì thêm cho cả `<bảng>` lẫn `<bảng>_raw`.

## View (`db/views/`)

- Tên file `NN_vw_ten.sql`, số đầu quyết định thứ tự dựng (view sau đọc view trước).
- Mở đầu bằng khối chú thích tiếng Việt: view trả lời câu hỏi gì, ai đọc, luật nào đúc vào.
- Giá trị lấy từ luật dùng chỗ giữ chỗ (`{MONEY_DIV_CASE}`…) do `sync/core/pg_view.py` thay — không gõ
  tỷ giá, số chia, giá vốn vào file.
- Sửa `vw_orders_std` hoặc `vw_fb_ads_std` là đụng gần như cả dashboard — soát mọi chỗ đọc.

## Đặt tên

- Bảng, cột, view, hàm: `snake_case` tiếng Anh, chữ thường. Bảng/cột tên Việt cũ đã đổi hết ở migration
  0008 (`tkqc` → `ad_accounts`, `bao_cao_tab` → `monthly_report_tabs`…, bảng đủ ở `docs/POSTGRES.md`); muốn
  đổi tên nữa thì viết migration mới, không sửa tay.
- Cột tiền ghi rõ đơn vị ở đuôi: `revenue_vnd`, `cost_price_rmb`.
- Alias cột trong SELECT cũng `snake_case` (Postgres hạ chữ thường alias không nháy).

## Đếm và nối

- Đếm đơn: `COUNT(DISTINCT order_uid)`.
- JOIN với bảng tra (danh mục, map): gom về một dòng mỗi khoá trước (`GROUP BY` / `DISTINCT ON`)
  rồi mới JOIN, để khỏi nhân dòng.
- Thử câu mới với khoảng ngày nhỏ trước, rồi mới chạy cả tháng.
