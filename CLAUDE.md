# TALPHA — hướng dẫn cho Claude Code

Dashboard vận hành cho đội ANTALO (Tiểu Alpha): bán trang sức và mỹ phẩm qua Facebook Ads +
chat-sale + COD ở **ba nước — Đài Loan, Singapore, UAE** (từ 15/09/2026), thêm **Nhật Bản**
(mở 08/10/2026, shop POS nối 09/10/2026; vận đơn Japan Post qua 17TRACK từ 21/10/2026). Mỗi nước một shop
POS Poscake (`config/talpha_rules.json → markets`); tài khoản quảng cáo Meta TỰ ĐỘNG — mọi TKQC các token
Meta đọc được (bảng `ad_accounts`, `/admin` → TKQC), chạy chung cho mọi nước.

**Đọc `DASHBOARD_MAP.md` trước khi sửa bất cứ thứ gì.** Nó là bản đồ nghiệp vụ: tiền
đi đường nào, số trên màn hình đến từ đâu, cái gì chạy ở đâu.

## Chạy

```bash
docker compose up -d --remove-orphans   # Postgres + dashboard http://localhost:3200 + lịch việc nền (service scheduler)
cd dashboard-ui && npm test             # phép thử logic đối soát, vận đơn, sổ đơn
DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \
  TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/   # rule nghiệp vụ + cách ghi số
```

**Service lịch đổi tên `lich` → `scheduler` (16/11/2026).** Lần đầu chạy bản này PHẢI có `--remove-orphans`:
thiếu nó thì container `talpha-lich-1` cũ vẫn chạy cạnh `scheduler` mới — hai lịch cùng kéo số mỗi giờ.

Trên máy Mac **phải** truyền `TALPHA_RULES`: loader Python ưu tiên
`~/talpha_reports/talpha_rules.json` — bản của hệ thống cũ (GCC) còn nằm trên Mac — nên chạy
trần là test đọc nhầm luật và báo lỗi giả.

Mở trang → `/admin` → Khoá kết nối: dán token Meta + key POS là việc nền tự kéo số. Chạy dashboard ngoài
Docker (`cd dashboard-ui && npm run dev`) thì đặt `DATABASE_URL` + `TALPHA_READONLY_PASSWORD` (tên cũ
`TALPHA_DOC_PASSWORD` vẫn nhận) trỏ vào Postgres của compose. Chi tiết: `docs/POSTGRES.md`.

## Deploy — từ máy Mac

```bash
git push upstream main                  # BẮT BUỘC trước — đẩy vào repo MÁY CHỦ KÉO, xem dưới
KEY=~/.ssh/id_ed25519 GH_KEY=~/.ssh/id_ed25519 bash ops/deploy/from-mac.sh
```

Máy chủ chạy `reset --hard origin/main` của repo NÓ clone: `nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA`
(`REPO_URL` ở `ops/deploy/vps-setup.sh`). Trên máy Mac này repo đó là remote **`upstream`** — `origin` là repo
riêng, đẩy vào đó thì deploy vẫn báo xanh mà máy chủ chạy code cũ. `from-mac.sh` tự dò remote trỏ tới repo máy
chủ và DỪNG nếu `main` còn commit chưa nằm ở đó (bước "0b", 16/11/2026).

Sửa `ops/talpha_reports/*` hoặc luật mà vòng ghi Sheet dùng thì chép thêm sang thư mục chạy
báo cáo trên máy chủ (bản chép riêng, KHÔNG tự cập nhật theo repo):

```bash
ssh root@139.180.131.21 'bash /opt/talpha/ops/talpha_reports/deploy_runtime.sh --yes'
```

`from-mac.sh` chép `dashboard-ui/.env.local` của Mac đè lên máy chủ — so hai bản trước khi chạy.

**Máy chủ VPS vẫn chạy bản BigQuery.** Kho số Postgres (nhánh `kho-postgres`, 04/11/2026) cần máy chủ có
Postgres + `DATABASE_URL` trước — các script `ops/deploy/vps-*-setup.sh` chưa dựng phần đó. Đừng đưa nhánh
này lên `main` rồi deploy khi máy chủ chưa chuyển.

## Kiến trúc

* **Giao diện + API**: Next.js 16 App Router + React 19 + TailwindCSS, tất cả trong
  `dashboard-ui/`. Không có backend riêng. Route lớn (`order-ledger`, `realtime`, `tracking`, `cod-recon`)
  chỉ nhận / trả, phần dựng nằm ở `<route>/_lib/*.ts`; tab lớn tách component con vào thư mục cùng tên
  (`components/talpha/tabs/cod-recon/`…; Ads Command Center ở `app/talpha/ads-command-center/_components/`).
* **Kho số**: Postgres ở `DATABASE_URL` (04/11/2026 — bỏ hẳn BigQuery, `docs/POSTGRES.md`). Bảng khai bằng
  migration `db/migrations/` (thêm file mới, không sửa file cũ), view ở `db/views/` dựng bằng
  `sync/core/pg_view.py` (luật đúc vào SQL, tự dựng lại khi luật đổi). Dashboard đọc qua `lib/db.ts`
  (`query(sql, { ten })` — tham số `@ten`). Câu SQL dựng ở trình duyệt / AI viết chạy bằng vai CHỈ ĐỌC
  (`queryReadOnly`, vai `talpha_readonly` / `talpha_readonly_market`) — đừng chạy chúng bằng `query()`.
  **Cấu trúc gốc là `0001_initial_schema.sql` (16/11/2026), tên tiếng Anh từ đầu** (`ad_accounts`, `fb_ads_all`,
  `monthly_report_tabs`, `view_fingerprints`, `date_in_tz`…): 9 migration của nhánh kho-postgres (chưa từng lên
  production) gộp lại, KHÔNG có bước đổi tên DB cũ — DB dựng bằng code kho-postgres phải sao lưu rồi dựng lại
  (`docs/POSTGRES.md` → "Chuyển từ kho-postgres", có bảng tên cũ ↔ mới).
* **Nguồn thô**: Meta Marketing API và POS Poscake — vừa đồng bộ theo giờ vào Postgres,
  vừa gọi thẳng cho các màn hình cần số tức thời. Bảng đơn của đối tác 3PL (Google Sheet)
  chép vào bảng `partner_orders` mỗi vòng sync.
* **Báo cáo số**: `format_all.py` (điểm chạy `main()`; phần việc ở `report_data` · `report_tables` ·
  `report_store` · `sheet_writer` cùng thư mục) dựng các tab "TỔNG TEAM THÁNG n" và ghi vào bảng `monthly_report_tabs`;
  tab Tổng quan, P&L, Marketer và bot Zalo đọc bảng đó qua `/api/talpha/sheet-report?from&to`. Có khoá
  Google (`bigquery_key.json`) thì ghi thêm file Google Sheet cho team — tuỳ chọn. Giá vốn + phí ship
  ước tính ở `lib/talpha/order-costs.ts` (dùng chung P&L và P&L theo SP). Các tab báo cáo
  không tính trước `report_start_date` (15/09/2026).
* **Lãi lỗ đủ mọi khoản** (Kế toán → Lãi lỗ, 04/11/2026): `lib/talpha/income-statement.ts` (hàm thuần, có
  test) + `income-statement-sources.ts` (kiện thật từng nước) → `/api/talpha/income-statement`. Đây là nơi trả lời
  "lãi thật bao nhiêu"; tab P&L của mục Báo cáo chỉ là số tạm tính.
* **Sync**: `sync/talpha/talpha_sync.py` (điều phối; đơn POS `order_sync.py`, chi tiêu `ads_sync.py`, ngân sách
  campaign `campaign_sync.py`, bảng đối tác `partner_orders_sync.py`) + `sync/core/`. Docker: service `scheduler`
  (`ops/docker/scheduler.py`; trước 16/11/2026 là service `lich`, file `lich.py`) cùng giờ các systemd timer của VPS.
* **TKQC tự động** (04/11/2026): mỗi vòng sync hỏi Meta mọi token (Khoá kết nối: `TALPHA_META_ACCESS_TOKEN`,
  `_2`, `_3` — nhiều BM / app) thấy TKQC nào, ghi bảng `ad_accounts`, kéo chi tiêu của TẤT CẢ vào `fb_ads_all`
  (`sync/core/ad_accounts.py` ↔ `lib/talpha/ad-accounts.ts`). `fb_ads_data` / `fb_adset_data` / `fb_campaign_data` là VIEW
  chỉ gồm TKQC thuộc loại có `include_in_report` (`talpha_rules.json → ad_account_categories`) — đọc tên cũ là
  tự đúng. Đổi loại ở `/admin` → TKQC, có tác dụng ngay. **Đừng ghi thẳng vào `fb_ads_data`** — nó là view.
  `talpha.yaml → ad_account_ids` chỉ còn là lịch sử (toàn dòng chú thích). `ops/talpha_reports/ad_accounts.json`
  CHỈ còn bản dòng lệnh đối soát quảng cáo đọc (roster bắt TKQC lạ, `ads_settlement.ad_accounts.roster_file`) —
  dashboard lấy roster từ bảng `ad_accounts` (TK có chi tiêu trong kỳ sao kê thẻ = "đang chạy", để báo thiếu bản kê).
* **Đăng nhập + phân quyền theo team** (05/10/2026): NextAuth v5 (`lib/auth.ts`); người dùng
  qua `lib/users.ts` (bảng `users`, mỗi người `role` + `teams`). Luật ở
  `talpha_rules.json → access`, đọc qua `lib/talpha/access-rules.ts` (có test). Cửa chặn chung:
  `src/proxy.ts` (Next 16, chạy Node). **Thêm route API mới thì khai vào `API_RULES`** — không
  khai là chỉ giám đốc gọi được. Route gộp nhiều nước phải tự lọc theo `getAccess()`.
  Bot/việc nền gọi API bằng header `x-talpha-token` (chìa ở `data/.internal_token`). DB trắng (chưa có ai trong
  bảng `users`) thì tạo giám đốc đầu tiên: `docker compose exec dashboard node scripts/create-user.mjs`.
* **Khoá kết nối** (04/11/2026): token Meta, key POS từng shop, token Pancake, key 17TRACK, khoá Gemini (15/11) nhập ở
  `/admin` → Khoá kết nối — máy gọi thử khoá rồi mới lưu. Lưu ở bảng `api_credentials` (15/11/2026),
  MÃ HOÁ bằng pgcrypto với chìa `TALPHA_ENCRYPTION_KEY` (đổi chìa = phải nhập lại mọi khoá), thắng khoá
  cùng tên trong `.env.local`. Giải mã từng dòng (`safe_decrypt`): khoá mã hoá bằng chìa khác bị bỏ + báo log, khoá
  khác vẫn chạy; chìa hiện tại không mở được khoá nào đang có thì KHÔNG cho lưu (chìa đã đổi). Dashboard đọc qua
  `getCredential()` (`lib/talpha/credentials.ts`) — **đừng đọc
  `process.env` thẳng cho khoá**; Python gọi `load_credentials_to_env()` (`sync/core/credentials.py`) lúc bắt đầu.
  Ngoại lệ có chủ đích (16/11/2026): trang Hỏi AI cho dán khoá Gemini RIÊNG, chỉ lưu localStorage của trình
  duyệt đó, gửi kèm từng câu hỏi (header `x-gemini-key`) và thắng khoá mặc định — máy chủ không lưu, không
  ghi log khoá này (`lib/talpha/gemini-key.ts`).
* **Thị trường trên trang** (04/11/2026): `/admin` → Thị trường thêm nước, sửa tỷ giá, tắt / bật nước.
  Lưu ở bảng `market_overrides` (15/11/2026), PHỦ lên `talpha_rules.json` ở cả dashboard
  (`lib/talpha/market-config.ts`), sync / Sheet / view (`sync/core/market_config.py`) và bot
  (`ops/zalo-alerts/market_config.js`) — ba bản chạy chung `tests/fixtures/market_overrides.json`, sửa
  luật phủ thì sửa cả ba. Shop POS sinh từ `markets` (`talpha.yaml → poscake` không còn ai đọc).
  Trạng thái nước `active` / `upcoming` / `disabled` (trước 16/11/2026: `dang_ban` / `sap_chay` / `da_tat` —
  file cũ `data/thi_truong.json` được `file_import.py` đổi lúc chép vào kho). Chỉ nước `active` được kéo đơn /
  gọi POS; `disabled` giữ lịch sử. Lưu xong
  dashboard và bot tự khởi động lại (pm2; docker nhờ `TALPHA_AUTO_RESTART=1`, tên cũ `TALPHA_TU_KHOI_DONG` vẫn
  nhận); vòng sync đầu giờ tự dựng lại view khi tỷ giá / số chia đổi.
* **Nạp lúc khởi động** (16/11/2026): `rules.ts` (luật gốc + phần phủ `market_overrides`) và `getCredential()`
  đọc ĐỒNG BỘ, nên `src/instrumentation.ts → register()` nạp sẵn hai bảng đó BẤT ĐỒNG BỘ một lần
  (`primeStartupData()`, `lib/talpha/startup-data.ts`) trước khi server nhận request — thay cho `execFileSync`
  (`db-sync.ts` + `scripts/sync-query.cjs`, đã xoá) từng chặn event loop. Bot cũng vậy: `bot.js` gọi
  `primeMarketOverrides()` (`market_config.js`, hỏi dashboard bằng `fetch`) rồi mới nạp `bot_main.js`. Module
  đọc luật bị nạp TRƯỚC bước này là chạy bằng luật gốc, thiếu nước nhập trên trang. Bước nạp có hạn 15 giây;
  kho lỗi / chưa lên thì dashboard vẫn mở cửa (luật gốc + khoá `.env.local`) và `startup-recovery.ts` đọc lại
  mỗi 30 giây — thị trường nhập trên trang khác luật đang chạy thì tự khởi động lại.
* **Dữ liệu người dùng nhập nằm trong Postgres** (15/11/2026):
  `app_documents` (sao kê COD, việc đối soát, thanh toán QC, vận đơn, chi phí vận hành — đọc/ghi qua
  `lib/talpha/store.ts`), `market_overrides`, `market_monthly_reports` (số nước × người cho bot, bot
  đọc qua `/api/talpha/market-report`), `users`, `api_credentials`. File cũ (`data/*.json`, `users.json`,
  `.env.khoa.local`) được `sync/core/file_import.py` chép vào MỘT lần ở bước migrate (sổ `file_imports`)
  rồi không ai đọc nữa. Vai chỉ đọc (`/api/query`, "CEO hỏi") bị REVOKE khỏi các bảng này —
  `pg_view.py → PRIVATE_TABLES`; thêm bảng riêng mới thì thêm vào đó. Còn là file: luật gốc
  `config/talpha_rules.json` (git) và chìa nội bộ `data/.internal_token`.
* **Bot Zalo cấu hình trên trang** (16/11/2026): `/admin` → Khoá kết nối → Zalo — ghép nick phụ bằng mã QR, chọn
  nhóm từng nước, gửi thử. Trang ghi yêu cầu (`zalo_requests`), bot `ops/zalo-alerts/bot_control.js` nhặt qua
  `/api/talpha/zalo/bot` (chìa nội bộ) và ghi trạng thái (`zalo_bot_status`); phiên Zalo vẫn là file trên máy chạy bot.
  Chi tiết: `docs/ZALO_BOT.md` mục 8.
* **Người dùng thấy và tự chạy cập nhật số** (15/11/2026): đèn "Cập nhật lúc…" + nút "Cập nhật ngay" trên
  thanh đầu (`components/talpha/refresh-status.tsx` ↔ `/api/talpha/refresh`). Lịch Docker ghi mỗi lượt vào
  `job_runs` và nhặt yêu cầu ở `refresh_requests` (`sync/core/job_log.py`). Thêm việc nền mới thì chạy qua
  `run_and_log()` của `ops/docker/scheduler.py` để nó hiện lên đèn.

## Nguyên tắc cứng — vi phạm là số sai hoặc mất dữ liệu

* **Rule nghiệp vụ khai ở `config/talpha_rules.json`, KHÔNG gõ vào code.** Tỷ giá, số
  chia tiền POS, tên marketer, phí 3PL, giá vốn, ngưỡng ROAS đều ở đó. Phía TypeScript đọc
  qua `lib/talpha/rules.ts`; phía Python qua `ops/talpha_reports/talpha_rules.py`.
* **Đường dẫn cấu hình hỏi `lib/talpha/config-path.ts`**, đừng tự ghép `process.cwd()`.
* **Số chia tiền POS không phải lúc nào cũng 100.** Shop Đài lưu nguyên TWD nên chia 1;
  Singapore và UAE chia 100 (đã đo trên đơn thật). Dùng `posMoneyDivisor()`, đừng gõ `/100`.
* **Chi phí quảng cáo đã là VND.** Không quy đổi thêm lần nào.
* **Kho số: không tự chạy DELETE / DROP / TRUNCATE lên bảng dữ liệu.** Sync ghi `<bảng>_raw` CHỈ THÊM, bảng
  sạch dựng lại từ raw trong MỘT transaction (`sync/core/pg_writer.py`) — fetch hỏng thì bảng cũ còn
  nguyên. Pattern drop-trước-khi-fetch bị CẤM (đã mất trắng dữ liệu ngày 06/07 vì nó).
* **Postgres khác BigQuery ở chỗ ra số sai mà không báo lỗi**: chia hai số nguyên là chia nguyên (dùng
  `safe_divide`), `GROUP BY tên` ưu tiên cột gốc, tên cột không trong nháy bị hạ chữ thường, nháy kép là
  tên cột chứ không phải chuỗi. Bảng dịch đủ: `docs/POSTGRES.md`.
* **Chỉ có MỘT engine sync**: `sync/talpha/talpha_sync.py`. Đừng chép bản thứ hai sang
  runtime — trước đây có hai bản cùng ghi một bộ bảng mỗi giờ và đè lẫn nhau.
* **Chỉ có MỘT file pm2**: `ops/pm2/ecosystem.vps.config.js`.
* **Không commit** `.env`, `bigquery_key.json`, `data/`, `config/manual_data/`.
* **Nhiều phiên Claude có thể sửa cùng thư mục cùng lúc.** Chỉ `git add` đúng file mình sửa,
  xem `git status` trước khi commit, đừng `git add -A`.

## Chẩn đoán số sai

Không bao giờ so Google Sheet với kho số — cùng nguồn nên cùng sai. Đối chiếu thẳng:

```bash
# Token Meta còn sống không, TKQC nào đọc được
python3 ops/talpha_reports/check_meta_token.py

# Sync lần gần nhất
ssh root@139.180.131.21 'journalctl -u talpha-sync -n 40 --no-pager'

# Vòng ghi Sheet lần gần nhất
ssh root@139.180.131.21 'tail -40 /root/talpha_reports/daily_$(date +%Y%m%d).log'
```

`/api/talpha/sync-health` trả tên TKQC / shop đọc lỗi của vòng gần nhất (`fetch_errors`).

Sheet lệch dashboard **là cố hữu** ở những màn còn tự tính từ kho số: sync theo giờ vs gọi
live, gom đơn theo giờ VN vs timezone từng TKQC. Đừng "fix cho khớp" từng ngày.

## Tài liệu

| File | Nội dung |
|:--|:--|
| `DASHBOARD_MAP.md` | Bản đồ nghiệp vụ — đọc trước tiên |
| `docs/TALPHA_METRIC_RULES.md` | Source of truth về công thức chỉ số |
| `docs/DEPLOY_VPS.md` | Dựng và cập nhật máy chủ |
| `docs/COD_RECONCILIATION.md` | Nghiệp vụ đối soát COD |
| `docs/CAMPAIGN_NAMING.md` | Quy ước đặt tên campaign (quyết định gán marketer) |
| `ops/pm2/README.md` | pm2 và systemd timer |
| `ops/talpha_reports/README.md` | Đường ống báo cáo Google Sheets |
| `docs/POSTGRES.md` | Kho số Postgres, chạy bằng docker compose, bảng dịch SQL BigQuery → Postgres |
| `docs/ZALO_BOT.md` | Bot Zalo: lịch gửi, nguồn số từng tin, đính chính khi số chưa đủ, vận hành |
