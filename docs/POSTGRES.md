# Kho Postgres — chuyển dần khỏi BigQuery

Bắt đầu 04/11/2026. Mục tiêu: TALPHA dựng như một dự án web thường — **code + một cơ sở dữ liệu**,
`docker compose up` là chạy, không phải dựng project Google Cloud, tài khoản máy, dataset, view.

## Lộ trình

| Bước | Việc | Trạng thái |
|:--|:--|:--|
| 0 | Xuất BigQuery ra file làm bản lưu | Để sau — dữ liệu cũ tính sau |
| 1 | `docker-compose.yml` (dashboard + Postgres), migration bảng thô, sync ghi được vào Postgres | **Xong** |
| 2 | Máy chủ chạy `TALPHA_KHO=ca_hai` — ghi cả hai kho 1–2 tuần, đối chiếu số mỗi ngày | Chưa |
| 3 | Dashboard, 4 script ghi Sheet, bot đọc Postgres; viết lại 12 view (`sql/talpha/views/`) | Chưa |
| 4 | Dồn `data/*.json` (COD, thanh toán QC, vận đơn), danh bạ TKQC, thị trường vào Postgres | Chưa |
| 5 | Tắt BigQuery | Chưa |

**Đang ở đâu sau bước 1:** sync kéo số mới vào Postgres được. Dashboard VẪN đọc BigQuery (cần
`bigquery_key.json` mới có số) — xem số trong Postgres bằng TablePlus / DBeaver hoặc lệnh `dem` ở dưới.

## Chạy trên máy thử

Cần Docker Desktop.

```bash
docker compose up -d                       # Postgres + migration + dashboard (lần đầu cài thư viện ~2 phút)
open http://localhost:3200/admin           # → Khoá kết nối: dán token Meta, key POS từng nước
docker compose run --rm sync               # kéo số mới từ Meta / POS vào Postgres (một lần)
docker compose run --rm migrate dem        # số dòng từng bảng + lần sync gần nhất
docker compose --profile lich up -d        # bật vòng kéo số mỗi giờ (tắt: docker compose stop lich)
docker compose logs -f dashboard           # xem log
docker compose down                        # dừng (dữ liệu Postgres còn nguyên trong volume)
```

Mở bằng TablePlus / DBeaver: host `127.0.0.1`, cổng `5433`, user `talpha`, mật khẩu `talpha`,
database `talpha`. Đổi cổng khi trùng: `PG_PORT=5434 DASHBOARD_PORT=3300 docker compose up -d`.

**Chỉ dùng trên máy thử.** Dashboard trong compose bỏ đăng nhập (`DASHBOARD_PUBLIC`), mật khẩu Postgres
là mặc định; cổng chỉ mở cho chính máy đó. Máy chủ thật vẫn chạy theo `ops/deploy/`.

Khoá nhập ở Khoá kết nối ghi vào `dashboard-ui/.env.khoa.local` (ngoài git); container sync đọc file
đó mỗi lần chạy. Bảng đơn đối tác 3PL (`partner_orders`) đọc Google Sheet nên cần `bigquery_key.json`
ở gốc repo — thiếu thì bước đó báo lỗi, đơn POS và tiền ads vẫn kéo bình thường.

## Chọn kho ghi: `TALPHA_KHO`

| Giá trị | Ghi vào | Dùng ở |
|:--|:--|:--|
| `bigquery` (mặc định) | BigQuery như cũ | Máy chủ hiện tại — không đặt gì là không đổi gì |
| `postgres` | Chỉ Postgres ở `DATABASE_URL`, không tạo client BigQuery | docker compose |
| `ca_hai` | Cả hai. BigQuery vẫn là số chính, Postgres lỗi chỉ ghi log | Bước 2 |

## Bảng

Migration `db/migrations/0001_bang_tho.sql`. Cột và kiểu chép đúng schema BigQuery trong
`sync/talpha/talpha_sync.py` — `tests/test_pg_writer.py` so hai bên, lệch là test đỏ.

| Bảng | Nội dung | Cách ghi |
|:--|:--|:--|
| `sale_order`, `order_items` | Đơn POS + dòng hàng | Hai tầng: `_raw` chỉ ghi thêm, bảng sạch dựng lại mỗi vòng |
| `fb_ads_data`, `fb_adset_data` | Chi tiêu theo ad / adset × ngày (đã là VND) | Hai tầng, bản `sync_time` mới nhất thắng |
| `fb_campaign_data` | Ngân sách campaign | Thay cả bảng |
| `partner_orders` | Bảng đơn đối tác 3PL | Thay cả bảng |
| `ad_dictionary` | ad_id lạ trên đơn (X9) | Chỉ ghi thêm |

Luật ghi giữ nguyên như BigQuery (`sync/core/pg_writer.py` dùng chung luật chọn đơn với
`bq_writer.py`): kéo hụt không xoá số đã có, đơn xoá trên POS có dòng "bia mộ", bảng sạch chỉ gồm shop
đang khai. Khác BigQuery một điểm có lợi: ghi raw và dựng lại nằm trong **một transaction** — lỗi giữa
chừng là mọi thứ quay về như trước vòng chạy.

Chưa chuyển (vẫn chỉ ở BigQuery): `product_catalog` (`sync_product_catalog.py`), `inventory_snapshot`
(`/api/talpha/sync-inventory`), `sync_health` (`report_health.py`), 12 view phân tích.

## Thêm cột / thêm bảng

Như Laravel: **thêm file mới** `db/migrations/0002_<ten>.sql`, đừng sửa file đã chạy (máy đã chạy file
đó sẽ không chạy lại). Thêm cột cho bảng hai tầng thì thêm vào cả bảng sạch lẫn `_raw`:

```sql
ALTER TABLE sale_order     ADD COLUMN ten_cot text;
ALTER TABLE sale_order_raw ADD COLUMN ten_cot text;
```

Migration chạy tự động khi `docker compose up` và ở đầu mỗi vòng sync; chạy tay:
`docker compose run --rm migrate`. Sync gặp dòng có cột bảng chưa có thì dừng và báo "thêm file
migration", không lặng lẽ bỏ cột. Nhớ sửa schema BigQuery trong `talpha_sync.py` cùng lúc chừng nào
còn chạy hai kho.

## Test

```bash
TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_pg_writer.py -q   # không cần Postgres
DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \
  TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_pg_writer.py -q   # chạy đủ
```

Phần chạy trên Postgres dựng một schema tạm rồi xoá — không đụng bảng thật của database đó.
