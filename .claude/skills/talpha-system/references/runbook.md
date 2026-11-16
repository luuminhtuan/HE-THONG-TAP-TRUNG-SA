# TALPHA — Runbook thao tác vận hành

> Làm theo từng bước. Mỗi thao tác ghi rõ máy nào (Mac dev / VPS 139.180.131.21).
> **Hai bản**: production (`main`, VPS, BigQuery) và nhánh `kho-postgres` (Postgres, `docker compose`).
> Mục nào không tách hai bản là viết thời BigQuery — **chưa soát lại sau khi chuyển Postgres (04/11/2026)**.

## 1. Thêm TKQC mới

**Nhánh `kho-postgres` — không khai tay ở đâu cả** (TKQC tự động, 04/11/2026):
1. Token Meta phải đọc được TKQC đó. TKQC ở Business Manager / app khác thì dán thêm token vào
   `/admin` → Khoá kết nối → ô "Token Meta 2" / "Token Meta 3" (máy gọi thử rồi mới lưu).
2. `/admin` → TKQC → "Quét TKQC ngay". TK không thuộc ANTALO thì chọn loại khác; TK tiền khác VND tự vào
   loại "Khác" (không vào báo cáo).
3. Vòng sync kế tiếp kéo chi tiêu; muốn ngay thì nút "Cập nhật ngay" trên thanh đầu.

**Production (`main`, thời danh sách khai tay — chưa soát lại):**

1. Verify quyền token trước: `curl "https://graph.facebook.com/v21.0/act_<ID>?access_token=$TALPHA_META_ACCESS_TOKEN"` (token System User talpha-sync, BM Mua 02 — lấy từ `~/talpha_reports/runtime/.env`).
2. Sửa ĐỦ các chỗ (thiếu 1 = undercount âm thầm):
   - `~/talpha_reports/runtime/config/ad_accounts.json` (bản sync THẬT đọc)
   - `ops/talpha_reports/ad_accounts.json` (bản git)
   - `config/projects/talpha.yaml` `meta_ads.ad_account_ids` (+ bản `dashboard-ui/config/projects/talpha.yaml` nếu có)
   - `ACCOUNT_NAMES` trong `dashboard-ui/src/app/api/talpha/realtime/route.ts` VÀ `dashboard-ui/src/app/talpha/ads-command-center/page.tsx`
3. Re-sync: chạy `sync_fb_ads` qua repo venv rồi `format_all.py` (giữ lock — xem §4).
4. Dashboard Mac: `cd dashboard-ui && npm run build && pm2 restart talpha-dashboard`.
5. Server: deploy rồi build + restart tương tự (xem §5).

## 2. Chẩn đoán "số sai / thiếu spend / thiếu đơn"

Theo đúng `docs/TALPHA_METRIC_RULES.md` §6 — tóm tắt:
1. Ground truth: spend = Meta API trực tiếp (`level=campaign, time_increment=1`); đơn = POS API live. **KHÔNG so Sheet ↔ kho số.**
2. So Meta ↔ `fb_ads_data` theo account: lệch >2% → sync ads hỏng → xem log vòng chạy (grep "Read timed out" / "request limit" / "PermissionError"): production `/root/talpha_reports/daily_YYYYMMDD.log` + `journalctl -u talpha-sync`; nhánh `kho-postgres` `docker compose logs scheduler` + `ops/talpha_reports/daily_YYYYMMDD.log` trong repo. `/api/talpha/sync-health` trả TKQC / shop đọc lỗi của vòng gần nhất.
3. So POS live ↔ `sale_order` theo marketer/ngày → sync đơn hỏng (grep "chết ở page").
4. Dấu hiệu kinh điển: ngày có ĐƠN nhưng 0 SPEND = sync ads mất account/ngày; đơn tụt so với sáng = sync ghi đè bộ thiếu.
5. Nhớ: GTC hôm nay ≈ 0 là đúng; từng ngày lệch tz là cố hữu (cả tháng mới khớp).

## 3. Re-sync tay (chữa cháy)

**Nhánh `kho-postgres`:**
```bash
docker compose restart scheduler                                               # chạy ngay một vòng kéo số + dựng báo cáo
docker compose run --rm sync python sync/talpha/talpha_sync.py --days 40       # kéo lại cả tháng trước
```
Hoặc nút "Cập nhật ngay" trên thanh đầu dashboard (lịch nhặt trong ~15 giây).

**Thời chạy runtime trên Mac (trước khi lên VPS — đường dẫn nay là `/root/talpha_reports/` trên VPS):**
```bash
cd ~/talpha_reports && GOOGLE_APPLICATION_CREDENTIALS=runtime/bigquery_key.json \
  <repo>/.venv/bin/python sync_month.py && .venv/bin/python format_all.py
```
- Chạy NỀN (sync full ~50-60' thời còn shop SA ~10k đơn). Production BigQuery: backup `bq cp` 5 bảng trước nếu sợ.
- Kill giữa chừng: phải `pkill -f daily_guarded` (wrapper tự chạy tiếp format_all).
- KHÔNG BAO GIỜ chạy `daily.sh` (bản bq rm nguy hiểm).

## 4. Lock kẹt (sheet không cập nhật, export không chạy)

- Lock = thư mục `~/talpha_reports/.lock` (mkdir + file pid) của daily_guarded.
- Kẹt >45' thì daily_guarded tự dọn; muốn dọn tay: kiểm tra không còn process
  (`pgrep -f "sync_month|format_all|daily_guarded"`) rồi `rmdir ~/talpha_reports/.lock`.

## 5. Deploy máy chủ 139.180.131.21

- **Đẩy `main` vào repo máy chủ kéo trước** — `REPO_URL` ở `ops/deploy/vps-setup.sh`; trên máy Mac
  hiện tại là remote `upstream`, KHÔNG phải `origin` (repo riêng). `from-mac.sh` tự kiểm, dừng nếu thiếu.
- **Cách duy nhất**: `bash ops/deploy/from-mac.sh` — chạy TỪ MÁY MAC. Nó chép `.env.local`
  + `bigquery_key.json` + `data/*.json` lên, rồi cho máy chủ mượn khoá GitHub của Mac qua
  `ssh -A` để `git fetch`, build, restart. Máy chủ KHÔNG có khoá GitHub riêng.
- **Đừng `git pull` trên máy chủ**: trả `Permission denied (publickey)` nhưng vẫn in
  `origin/main` cũ nên trông như đã mới nhất. Đã dính 11/09: VPS kẹt một commit suốt 17 giờ.
- Dashboard: `/opt/talpha/dashboard-ui`, pm2 `talpha-dashboard` port **3000**.
  Login lỗi → kiểm `AUTH_URL` trong `.env.local` phải trỏ đúng cổng.
  Cách bật: `ops/pm2/README.md`.
- pm2: app TALPHA nằm namespace `talpha` → `pm2 restart talpha`. Config DUY NHẤT:
  `ops/pm2/ecosystem.vps.config.js`.
- **Đừng rsync tay**: rsync từng file KHÔNG xoá file đã bỏ khỏi repo, nên máy chủ giữ
  lại file chết (đã dính `daily.sh`, `ecosystem.config.js`).

## 6. Bot Zalo (bot WhatsApp đã xoá 30/10/2026)

- Vận hành, ghép nick, đổi nhóm: `ops/zalo-alerts/README.md`. Lịch gửi, nguồn số từng tin: `docs/ZALO_BOT.md`.
- Production: pm2 `talpha-zalo-alerts`. Nhánh `kho-postgres`: `docker compose --profile zalo run --rm zalo node pair.js`
  để ghép nick, rồi `docker compose --profile zalo up -d zalo`.
- Base URL dashboard: env `TALPHA_DASHBOARD_URL` (production mặc định `http://localhost:3000`), ĐỪNG sửa
  `config.json` rồi commit.

## 7. Vị trí log

Nhánh `kho-postgres`: `docker compose logs -f scheduler` (việc nền), `docker compose logs -f dashboard`,
`ops/talpha_reports/daily_YYYYMMDD.log` (vòng báo cáo), bảng `job_runs` (đèn "Cập nhật lúc…").

Production (VPS):
- Vòng ghi Sheet: `/root/talpha_reports/daily_YYYYMMDD.log`
- Sync vào BigQuery: `journalctl -u talpha-sync -n 60 --no-pager`
- Dashboard: `/var/log/talpha/dashboard-{out,error}.log`, hoặc `pm2 logs talpha-dashboard`
- Lịch chạy: `systemctl list-timers 'talpha-*'`

## 8. Billing TKQC

Route `/api/talpha/billing` và bot WhatsApp dùng nó đã xoá 30/10/2026 (bot chưa từng chạy
trên VPS). Cần lại cảnh báo hạn mức thì làm trong bot Zalo.

## 9. Meta token chết

Nhánh `kho-postgres`: dán token mới ở `/admin` → Khoá kết nối (máy gọi thử rồi mới lưu, mã hoá vào bảng
`api_credentials`); việc nền đọc lại khoá trước mỗi việc. Kiểm nhanh: `python3 ops/talpha_reports/check_meta_token.py`.

Production:

Triệu chứng: sync ads 0 rows mọi account / lỗi OAuth. Lấy lại: Business Manager "Mua 02"
→ System User `talpha-sync` (app abcd) → generate token mới → cập nhật
`~/talpha_reports/runtime/.env` `TALPHA_META_ACCESS_TOKEN` (+ env dashboard nếu có).
Chi tiết: memory `talpha-meta-token`.
