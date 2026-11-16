---
paths:
  - "db/**/*.sql"
  - "sync/**/*.py"
  - "ops/talpha_reports/**/*.py"
  - "dashboard-ui/src/app/api/**/*.ts"
  - "dashboard-ui/src/lib/**/*.ts"
---
# Luật dữ liệu — kho số Postgres TALPHA

> Kho số là Postgres ở `DATABASE_URL` (nhánh `kho-postgres`, từ 04/11/2026). Máy chủ VPS và nhánh
> `main` (production) VẪN chạy bản BigQuery — luật dưới đây là của nhánh Postgres.
> Chi tiết: `docs/POSTGRES.md`. Công thức chỉ số: `docs/TALPHA_METRIC_RULES.md`.

## 1. Không bao giờ làm mất dữ liệu

- **KHÔNG tự chạy `DELETE` / `DROP` / `TRUNCATE`** lên bảng dữ liệu, kể cả "dọn cho sạch".
- Sync ghi `<bảng>_raw` **CHỈ THÊM**; bảng sạch dựng lại từ raw trong **MỘT transaction**
  (`sync/core/pg_writer.py`). Fetch hỏng giữa chừng thì bảng cũ còn nguyên.
- Pattern xoá-trước-rồi-mới-fetch bị **CẤM** — đã mất trắng dữ liệu ngày 06/07/2026 vì nó.
- `fb_ads_data`, `fb_adset_data`, `fb_campaign_data` là **VIEW** (chỉ TKQC loại vào báo cáo).
  Ghi thì ghi vào bảng gốc của TKQC (`fb_ads_tat_ca`…) qua engine sync — đừng ghi thẳng vào view.
- `docker compose down -v` xoá volume `pgdata` = mất cả kho số. Không chạy khi chưa được dặn.

## 2. Bảng và view

- Bảng khai bằng migration `db/migrations/NNNN_ten.sql`, chạy theo thứ tự tên, ghi tên file vào
  `schema_migrations`. **Thêm file mới, không sửa file đã chạy, không đổi tên file cũ** (đổi tên là
  nó chạy lại).
- View ở `db/views/NN_ten.sql`, dựng bằng `sync/core/pg_view.py`. Tỷ giá, số chia, giá vốn, múi giờ
  TKQC, ngưỡng **đúc vào SQL lúc dựng** từ `config/talpha_rules.json` (các chỗ `{MONEY_DIV_CASE}`…).
  Đừng gõ số đó vào file view. Đầu mỗi vòng sync tự dựng lại khi SQL sinh ra đổi.
- Bảng dữ liệu người dùng nhập (`app_documents`, `market_overrides`, `market_monthly_reports`,
  `users`, `api_credentials`…) bị REVOKE khỏi vai chỉ đọc. Thêm bảng riêng mới → thêm vào
  `pg_view.py → BANG_RIENG`.

## 3. Ra số sai mà KHÔNG báo lỗi — soát từng câu

1. Chia hai số nguyên là chia NGUYÊN (`3/4 = 0`). Dùng `safe_divide(a, b)` hoặc ép `::float8`.
2. `GROUP BY ten` ưu tiên CỘT GỐC trùng tên, không phải cột ở SELECT — chắc ăn `GROUP BY 1, 2`.
3. Tên cột không trong nháy bị hạ chữ thường (`AS cpoChung` → `cpochung`). Đặt `cpo_chung`.
4. Nháy kép `"…"` là TÊN cột / bảng, không phải chuỗi. Chuỗi dùng nháy đơn.
5. `ORDER BY … DESC` xếp NULL lên ĐẦU — ghi `NULLS LAST` khi thứ tự quyết định số.
6. Ngày theo giờ VN: `ngay_theo_mui(chuỗi giờ UTC, 'Asia/Ho_Chi_Minh')`. Ngày giờ của đơn
   (`inserted_at`, `updated_at`, `sync_time`) lưu dạng CHUỖI.

## 4. Luật nghiệp vụ trong câu SQL

- **Đếm / dedupe đơn bằng `order_uid`** (= `shop_label-id`), không bằng `order_id` — POS đánh số
  riêng từng shop. JOIN sang `order_items` phải ghép cả `shop_id`.
- **Doanh thu** đọc `vw_orders_std.revenue_vnd` (đã ÷ số chia của shop × tỷ giá). Tự tính từ
  `sale_order.cod` thì chia `pos_money_divisor` của shop — Đài, Nhật 1; Singapore, UAE 100.
  KHÔNG gõ `/100`.
- **Chi phí quảng cáo đã là VND** — không quy đổi thêm. Cột ngày là `date`.
- Đơn giao thành công: `status_category = 'GIAO_THANH_CONG'`.
- Chi tiêu Meta gán về nước bằng **ô đầu tên campaign** (`TW` · `SG` · `AE` · `JP`).

## 5. Ai được chạy câu gì

- Dashboard đọc qua `lib/db.ts`: `query(sql, { ten })`, tham số viết `@ten`.
- Câu SQL dựng ở trình duyệt hoặc do AI viết (`/api/query`, Hỏi AI) chạy bằng vai **CHỈ ĐỌC**
  (`queryChiDoc`, migration 0003) — đừng chạy chúng bằng `query()`.
- Python nối kho qua `sync/core/pg.py` (`ket_noi()`).

## 6. Chẩn đoán số sai

Ground truth là **Meta API** (chi tiêu) và **POS API** (đơn). **Không bao giờ so Google Sheet với
kho số** — cùng nguồn nên cùng sai. `/api/talpha/sync-health` trả TKQC / shop đọc lỗi của vòng gần nhất.
