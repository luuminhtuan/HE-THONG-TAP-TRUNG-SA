# Kho số Postgres — chạy TALPHA bằng Docker

Từ 04/11/2026 (nhánh `kho-postgres`) TALPHA bỏ hẳn BigQuery: số nằm trong một Postgres, cả hệ thống chạy
bằng `docker compose up -d` — như một dự án web thường, code + một database. Không cần project Google
Cloud, tài khoản máy, dataset hay script dựng view nào nữa.

## Mở lên và dùng

Cần Docker Desktop.

```bash
docker compose up -d --remove-orphans   # Postgres + dashboard + lịch việc nền (lần đầu cài thư viện ~1 phút)
```

`--remove-orphans`: service lịch tên `scheduler` (trước 16/11/2026 là `lich`) — máy từng chạy bản cũ mà thiếu cờ
này thì container `talpha-lich-1` cũ vẫn chạy cạnh `scheduler`, hai lịch cùng kéo số mỗi giờ. Máy từng chạy bản
cũ còn phải dựng lại DB — xem "Chuyển từ kho-postgres" bên dưới.

1. Mở **http://localhost:3200/admin** → **Khoá kết nối**: dán token Meta, key POS từng nước (Pancake,
   17TRACK nếu có). Máy gọi thử khoá rồi mới lưu. TKQC nằm ở nhiều Business Manager / app thì dán thêm
   token vào ô "Token Meta 2", "Token Meta 3".
2. **/admin → TKQC**: bấm "Quét TKQC ngay" — hiện mọi TKQC các token thấy. Chọn loại cho TK nào không
   thuộc ANTALO (vd bán hạt giống trong nước); TK tiền khác VND tự vào loại "Khác".
3. Xong. Lịch việc nền đọc lại khoá trước mỗi việc — đầu giờ kế tiếp là có số. Muốn có ngay:
   `docker compose restart scheduler` — bật lại là chạy ngay một vòng kéo số + dựng báo cáo tháng (tab Tổng
   quan / P&L / Marketer). Vòng báo cáo tự kéo lại cả tháng hiện tại (đơn 30 ngày, chi tiêu từ ngày 1);
   muốn có cả tháng trước: `docker compose run --rm sync python sync/talpha/talpha_sync.py --days 40`.

Dashboard trong compose **bỏ đăng nhập** (`DASHBOARD_PUBLIC`) và mật khẩu Postgres là mặc định; cổng chỉ mở
cho chính máy đó (127.0.0.1). Đưa ra ngoài thì phải bật đăng nhập (bỏ `DASHBOARD_PUBLIC`, đặt
`AUTH_SECRET` thật) và đổi mật khẩu.

| Lệnh | Việc |
|:--|:--|
| `docker compose logs -f scheduler` | xem các việc nền chạy |
| `docker compose logs -f dashboard` | log dashboard |
| `docker compose run --rm migrate dem` | số dòng từng bảng + lần sync gần nhất |
| `docker compose run --rm migrate view --ep` | dựng lại bộ view ngay |
| `docker compose down` | dừng — dữ liệu còn nguyên trong volume `talpha_pgdata` |
| `docker compose down -v` | dừng và **XOÁ SẠCH** dữ liệu Postgres |

Mở database bằng TablePlus / DBeaver: `127.0.0.1:5433`, user / mật khẩu / database đều `talpha`. Trùng
cổng thì: `PG_PORT=5434 DASHBOARD_PORT=3300 docker compose up -d`.

## Cái gì chạy

| Dịch vụ | Việc |
|:--|:--|
| `db` | Postgres 17 |
| `migrate` | chạy mỗi lần `up`: bảng còn thiếu (`db/migrations/`) + dựng lại view nếu luật đổi |
| `dashboard` | Next.js (`next dev`) ở cổng 3200 |
| `scheduler` | việc nền, giờ Việt Nam (`ops/docker/scheduler.py`) — cùng giờ systemd timer của máy chủ (trước 16/11/2026 tên `lich`) |
| `zalo` (tuỳ chọn) | bot Zalo: `docker compose --profile zalo run --rm zalo node pair.js` để ghép nick, rồi `docker compose --profile zalo up -d zalo` |

Lịch việc nền: :00 mỗi giờ kéo đơn POS + chi tiêu Meta · :20 dựng báo cáo tháng · :40 chụp tồn kho dự
phòng · 05:10 danh mục sản phẩm · 06:00 và 21:30 nạp bảng đối tác + đồng bộ vận đơn. Bật container là
chạy ngay một vòng kéo số + báo cáo.

## Khoá Google — tuỳ chọn

Không có khoá Google thì mọi tab vẫn đủ số. Có file `bigquery_key.json` (tài khoản máy Google) ở gốc repo
thì thêm được hai thứ:

* ghi file Google Sheet "TỔNG TEAM THÁNG n" + file riêng từng người cho team xem như trước;
* đọc bảng đơn của đối tác 3PL (Singapore, Nhật) → vận đơn, sổ đơn, tiền COD của hai nước đó.

## Báo cáo tháng không còn phụ thuộc Google Sheet

`ops/talpha_reports/format_all.py` giữ nguyên toàn bộ luật tính (gán đơn theo page, tách camp test, chia
tin nhắn Nhật, lấn nước…), chỉ đổi nguồn sang Postgres. Các tab của file TỔNG TEAM ghi vào bảng
`monthly_report_tabs` TRƯỚC — tab Tổng quan, P&L, Marketer và bot Zalo đọc từ đó (`/api/talpha/sheet-report`) —
rồi mới ghi Sheet nếu có khoá. Một lần tính, ba nơi cùng số.

## Bảng và view

* **Bảng**: `db/migrations/` — chạy theo thứ tự tên, mỗi file một lần (bảng `schema_migrations`), như
  `php artisan migrate`. Cấu trúc gốc là `0001_initial_schema.sql` (16/11/2026, tên tiếng Anh từ đầu).
  **Thêm file mới (`0002_…`), đừng sửa file đã chạy.** Bảng hai tầng (đơn, dòng hàng, quảng cáo) có
  `<bảng>_raw` chỉ ghi thêm + bảng sạch dựng lại mỗi vòng — thêm cột thì thêm vào cả hai.
* **View**: `db/views/` — tỷ giá, số chia, giá vốn, múi giờ TKQC, nhóm marketer, ngưỡng đúc vào câu SQL
  lúc dựng (`sync/core/pg_view.py`, sinh từ `config/talpha_rules.json` + `talpha.yaml`). Đầu mỗi vòng
  sync băm câu SQL đã sinh; khác lần trước là dựng lại trong một transaction.
* **Vai chỉ đọc** (migration 0001, mục 6): `/api/query` (4 tab Marketing, Sức khoẻ QC, Khách hàng, Market
  Intel) và "CEO hỏi" đăng nhập Postgres bằng `talpha_readonly` / `talpha_readonly_market` (`queryReadOnly`
  trong `lib/db.ts`), transaction READ ONLY, 30 giây, trả kết nối về pool sau `RESET ALL`. Mật khẩu:
  `TALPHA_READONLY_PASSWORD` (compose đặt sẵn; tên cũ `TALPHA_DOC_PASSWORD` vẫn nhận), đặt lúc `migrate`.

| Bảng | Nội dung |
|:--|:--|
| `sale_order`, `order_items` (+ `_raw`) | đơn POS + dòng hàng |
| `fb_ads_all`, `fb_adset_all` (+ `_raw`) | chi tiêu MỌI TKQC theo ad / adset × ngày (đã là VND) |
| `fb_ads_data`, `fb_adset_data`, `fb_campaign_data` | **VIEW** — chỉ TKQC loại vào báo cáo; đọc, không ghi |
| `ad_accounts` | danh bạ TKQC tự động: tên, trạng thái Meta, tiền tệ, múi giờ, token đọc nó, **loại** (`category`, đổi ở /admin → TKQC) |
| `fb_campaign_all`, `ad_dictionary` | ngân sách campaign; ad_id lạ trên đơn |
| `partner_orders` | bảng đơn đối tác 3PL (cần khoá Google) |
| `product_catalog` | danh mục SP — nối biến thể POS → mã SKU (giá vốn) |
| `inventory_snapshot` | ảnh chụp tồn kho, dự phòng tab Kho (giữ 60 ngày) |
| `sync_health`, `sync_health_accounts` | sức khoẻ vòng chạy, theo từng TKQC / shop |
| `monthly_report_tabs` | bảng số báo cáo tháng (= nội dung file TỔNG TEAM) |
| `view_fingerprints` | vân tay SQL của bộ view lần dựng gần nhất (`pg_view.py`) |

## Chuyển từ kho-postgres (DB dựng trước 16/11/2026)

Nhánh `kho-postgres` (04–16/11/2026) chưa từng lên production, nên 16/11/2026 bộ 9 migration của nó gộp thành
`0001_initial_schema.sql` dựng thẳng tên tiếng Anh — **không có bước đổi tên / chuyển đổi DB cũ**. Kho dựng bằng
code cũ (có bảng `tkqc`, `bao_cao_tab`…) không chạy tiếp được bằng code này: sao lưu rồi dựng lại từ đầu.

```bash
mkdir -p data/backups && docker compose exec -T db pg_dump -U talpha -Fc talpha > data/backups/talpha-truoc-chuyen.dump
docker compose stop dashboard scheduler lich 2>/dev/null
docker compose exec db psql -U talpha -d postgres -c "DROP DATABASE talpha WITH (FORCE)" -c "CREATE DATABASE talpha"
docker compose up -d --remove-orphans          # migrate dựng 0001 + view, dashboard + scheduler lên lại
```

Sau đó nhập lại khoá (/admin → Khoá kết nối, hoặc chép thẳng bảng `api_credentials` từ bản sao lưu — giá trị đã mã
hoá, chép nguyên được nếu `TALPHA_ENCRYPTION_KEY` không đổi), tạo tài khoản đăng nhập
(`docker compose exec dashboard node scripts/create-user.mjs`), rồi kéo lại số (mục "Còn lại" bên dưới).
Vai chỉ đọc tên cũ `talpha_doc` / `talpha_doc_nuoc` còn trên cụm thì bỏ: `DROP ROLE talpha_doc, talpha_doc_nuoc`
(sau khi không còn DB nào cấp quyền cho chúng).

Câu SQL cũ, ghi chú cũ còn dùng tên cũ thì dịch theo bảng này:

| Tên cũ | Tên mới |
|:--|:--|
| `tkqc` (`ten`, `trang_thai`, `tien_te`, `mui_gio`, `loai`, `da_xac_nhan`, `thay_lan_dau`, `thay_lan_cuoi`, `ghi_chu`, `bien_token`) | `ad_accounts` (`name`, `account_status`, `currency`, `timezone_name`, `category`, `is_confirmed`, `first_seen_at`, `last_seen_at`, `note`, `token_env_var`) |
| `fb_ads_tat_ca` · `fb_adset_tat_ca` (+ `_raw`) · `fb_campaign_tat_ca` | `fb_ads_all` · `fb_adset_all` (+ `_raw`) · `fb_campaign_all` |
| `bao_cao_tab` (`thang`, `tep`, `thu_tu`, `ten_tab`, `hang`, `ghi_luc`) | `monthly_report_tabs` (`month`, `report_key`, `tab_order`, `tab_name`, `rows`, `written_at`) |
| `view_van_tay` (`van_tay`, `dung_luc`) | `view_fingerprints` (`fingerprint`, `built_at`) |
| `schema_migrations` (`ten`, `chay_luc`) | `schema_migrations` (`name`, `applied_at`) |
| hàm `ngay_theo_mui(s, tz)` | `date_in_tz(s, tz)` |
| vai `talpha_doc` · `talpha_doc_nuoc` | `talpha_readonly` · `talpha_readonly_market` |
| dòng `app_documents`: `ads_recon_kho` · `chi_phi_van_hanh` | `ads_recon_rows` · `operating_expenses` |
| giá trị cấu hình: trạng thái nước `dang_ban` / `sap_chay` / `da_tat`, khoá `nguoi_cam`; loại TKQC `hat_giong` / `khac` | `active` / `upcoming` / `disabled`, `owner`; `seed` / `other` |

File của bản chạy bằng file (máy chủ VPS khi chuyển sang Postgres): bước `migrate` chép `data/*.json` vào kho và
TỰ đổi tên / giá trị cũ ở bảng trên (`sync/core/file_import.py`) — không cần sửa file tay.

## Viết SQL: BigQuery → Postgres

Database có sẵn các hàm giữ nghĩa BigQuery: `safe_divide(a, b)`, `round(số thực, n)`, `safe_ts(chuỗi)`,
`date_in_tz(chuỗi giờ UTC, 'Asia/Ho_Chi_Minh')`, `safe_json(chuỗi)`.

| BigQuery | Postgres |
|:--|:--|
| `IFNULL(a, b)` · `IF(c, a, b)` · `COUNTIF(c)` | `COALESCE(a, b)` · `CASE WHEN c THEN a ELSE b END` · `COUNT(*) FILTER (WHERE c)` |
| `SAFE_DIVIDE(a, b)` · `LOGICAL_OR` | `safe_divide(a, b)` · `bool_or` |
| `DATE_SUB(d, INTERVAL n DAY)` · `DATE_DIFF(a, b, DAY)` | `d - n` · `a - b` |
| `DATE(TIMESTAMP(inserted_at), 'Asia/Ho_Chi_Minh')` | `date_in_tz(inserted_at, 'Asia/Ho_Chi_Minh')` |
| `CAST(x AS STRING / INT64 / FLOAT64)` | `x::text / bigint / double precision` |
| `JSON_EXTRACT_SCALAR(m, '$.name')` | `safe_json(m) ->> 'name'` |
| `REGEXP_CONTAINS(s, r'p')` · `REGEXP_EXTRACT` · `REGEXP_REPLACE` | `s ~ 'p'` · `substring(s from 'p')` · `regexp_replace(s, 'p', x, 'g')` |
| `x IN UNNEST(@ds)` · `ARRAY_AGG(x ORDER BY y LIMIT 1)[OFFSET(0)]` | `x = ANY(@ds)` · `(ARRAY_AGG(x ORDER BY y))[1]` |

**Bẫy ra số sai mà không báo lỗi** — soát từng câu:

1. Chia hai số nguyên là chia NGUYÊN (3/4 = 0). Dùng `safe_divide` hoặc ép `::float8`.
2. `GROUP BY ten` ưu tiên CỘT GỐC trùng tên, không phải cột ở SELECT — chắc ăn `GROUP BY 1, 2`.
3. Tên cột không trong nháy bị hạ chữ thường: `AS cpoChung` trả về `cpochung`. Đặt tên `cpo_chung`.
4. Nháy kép `"…"` là TÊN cột / bảng, không phải chuỗi. `GREATEST/LEAST` bỏ qua NULL.
5. NULL xếp ĐẦU khi `ORDER BY … DESC` (BigQuery xếp cuối) — ghi rõ `NULLS LAST` khi thứ tự quyết định số.

## Test

```bash
docker compose up -d db
DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \
  TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/ -q
```

Phần chạy trên Postgres dựng một schema tạm rồi xoá — không đụng bảng thật. Dữ liệu mẫu để thử giao diện
khi chưa có khoá (4 nước, 40 ngày, KHÔNG phải số thật — chỉ ghi vào database đang trống):
`docker compose run --rm --entrypoint python migrate tests/fixtures/sample_data.py`. Xoá đi trước khi nhập
khoá thật: `docker compose down -v && docker compose up -d`.

## Còn lại

* ~~Máy chủ VPS còn chạy BigQuery~~ — chuyển xong tối 16/11/2026 (`docs/DEPLOY_VPS.md` → "Bản Postgres trên máy chủ";
  dựng: `ops/deploy/vps-postgres-setup.sh`).
* **Dữ liệu cũ trên BigQuery** chưa chép sang (chốt 04/11/2026: tính sau). Đơn POS và chi tiêu Meta kéo lại
  được bằng `python sync/talpha/talpha_sync.py --full` và `--days N`; ảnh chụp tồn kho cũ thì không.
* ~~`data/*.json`, thị trường, người dùng, khoá vẫn là file~~ — xong 15/11/2026 (xem mục dưới).

## Dữ liệu người dùng nhập — cũng trong Postgres (15/11/2026)

| Bảng | Thay cho | Đọc / ghi ở |
|:--|:--|:--|
| `app_documents` | `data/<kho>.json` — sao kê COD, việc đối soát, thanh toán QC, vận đơn, chi phí vận hành | `lib/talpha/store.ts` |
| `market_overrides` | `data/thi_truong.json` | `lib/talpha/market-store.ts`, `rules.ts`, `sync/core/market_config.py`, bot qua `/api/talpha/market-config?overrides=1` |
| `market_monthly_reports` | `data/bao_cao_nuoc/<tháng>.json` | `format_all.py` ghi; `lib/talpha/market-monthly-report.ts`, bot qua `/api/talpha/market-report` |
| `users` | `config/users.json` / `USERS_JSON` | `lib/users.ts` |
| `api_credentials` | `dashboard-ui/.env.khoa.local` — MÃ HOÁ (pgcrypto) bằng `TALPHA_ENCRYPTION_KEY` | `lib/talpha/credentials.ts`, `sync/core/credentials.py` |
| `file_imports` | — sổ file cũ nào đã chép vào kho | `sync/core/file_import.py` |
| `job_runs` · `refresh_requests` | — sổ lượt việc nền + yêu cầu "Cập nhật ngay" | `ops/docker/scheduler.py` qua `sync/core/job_log.py`; dashboard đọc ở `/api/talpha/refresh` |
| `zalo_bot_status` · `zalo_requests` | — (migration 0002) trạng thái bot Zalo + yêu cầu bấm ở /admin → Khoá kết nối → Zalo | bot `ops/zalo-alerts/bot_control.js` qua `/api/talpha/zalo/bot`; trang qua `/api/talpha/zalo` (`lib/talpha/zalo-bot.ts`) |

Bước `migrate` chép mỗi file cũ vào kho MỘT lần (không ghi đè dòng đã có, không xoá file) — chép lần
hai sẽ làm sống lại thứ người dùng đã xoá trên trang. Sau đó file cũ chỉ còn là bản lưu.

`TALPHA_ENCRYPTION_KEY` phải giống nhau ở dashboard và các container Python (compose đặt sẵn một chìa
cho máy thử). Mất / đổi chìa là khoá trong kho không giải mã được nữa — nhập lại ở /admin → Khoá kết
nối. Hai vai chỉ đọc không được đọc các bảng này (REVOKE cuối migration 0001 và `pg_view.py → PRIVATE_TABLES`).

Khi chuyển máy chủ VPS sang Postgres: đặt `TALPHA_ENCRYPTION_KEY` (chìa thật, giữ kín) cho dashboard + các
service Python, rồi chạy migrate trong `/opt/talpha` — sao kê, vận đơn, `users.json`, `.env.khoa.local`
của máy chủ tự vào kho. Drop-in `khoa.conf` của `vps-setup.sh` khi đó không cần nữa.
