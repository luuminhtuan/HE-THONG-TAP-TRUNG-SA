---
name: talpha-system
description: Bản đồ hệ thống + rule chỉ số + bẫy vận hành của TALPHA (dashboard ads bốn nước Đài Loan · Singapore · UAE · Nhật, báo cáo tháng + Google Sheets, tồn kho, đối soát COD và chi phí quảng cáo, bot Zalo; kho số Postgres ở nhánh kho-postgres, production vẫn BigQuery cty-507710.TALPHA_Dataset). LUÔN dùng skill này TRƯỚC KHI làm bất cứ việc gì đụng tới số liệu, dashboard, sheet báo cáo, sync, tồn kho, hay chẩn đoán "số sai/thiếu/lệch" trong dự án TALPHA — kể cả khi user chỉ hỏi "sao spend hôm nay thiếu", "đơn của X đâu", "thêm TKQC mới", "sửa báo cáo". Không đọc skill này trước khi sửa code liên quan số liệu = rủi ro phá rule đã được CEO duyệt.
---

# TALPHA System — bản đồ hệ thống & rule chỉ số

Bán trang sức/mỹ phẩm qua Facebook Ads + chat-sale + COD ở **bốn nước**: Đài Loan, Singapore,
UAE (cả ba từ 15/09/2026) và Nhật Bản (mở 08/10/2026). Mỗi nước một shop POS Poscake, một team
riêng. Hệ thống = dashboard + báo cáo tháng (+ Google Sheets) + tồn kho + đối soát tiền + bot Zalo.

**Hai bản đang song song:**

| | Production | Nhánh `kho-postgres` (04/11/2026) |
|---|---|---|
| Nhánh git | `main` | `kho-postgres` |
| Kho số | BigQuery `cty-507710.TALPHA_Dataset` | Postgres `DATABASE_URL` (`docs/POSTGRES.md`) |
| Chạy ở | VPS `139.180.131.21`, pm2 + systemd timer | `docker compose up -d` trên máy bất kỳ — CHƯA lên VPS |

Bản đồ nghiệp vụ đầy đủ trong repo: **`DASHBOARD_MAP.md`** — đọc nó trước. Hướng dẫn làm việc: `CLAUDE.md`.

## 1. Cái gì chạy ở đâu

```
Meta API (mọi TKQC token đọc được) ─┐
                                     ├─ sync :00 mỗi giờ ─► kho số ─┬─ /api/query ─► tab báo cáo
POS Poscake (mỗi nước một shop) ────┘   talpha_sync.py              │
                      vòng báo cáo :20 ─ format_all.py ─► bảng bao_cao_tab (+ Google Sheets nếu có khoá)
                                                                    └─► Tổng quan, P&L, Marketer, bot Zalo

Meta API + POS ──live──► /api/talpha/realtime   ─► Ads Command Center
POS            ──live──► /api/talpha/inventory  ─► tab Sản phẩm & Kho
File tải lên   ────────► /api/talpha/{cod-recon, ads-recon, tracking} ─► đối soát, vận đơn
```

| Thành phần | Production (VPS) | Nhánh `kho-postgres` (docker compose) |
|---|---|---|
| Dashboard | `/opt/talpha`, pm2 `talpha-dashboard` cổng 3000 | service `dashboard`, http://localhost:3200 |
| Sync | systemd `talpha-sync.timer` → `sync/talpha/talpha_sync.py` | service `lich` (`ops/docker/scheduler.py`) cùng giờ |
| Báo cáo tháng | systemd `talpha-report.timer` → `/root/talpha_reports/daily_guarded.sh` | `lich` → `ops/talpha_reports/daily_guarded.sh` trong repo |
| Bot Zalo | pm2 `talpha-zalo-alerts`, mỗi nước một nhóm | service `zalo` (tuỳ chọn) |
| Bot WhatsApp | **Đã xoá 30/10/2026** (chưa từng chạy trên VPS) | — |
| Máy Mac | Chỉ là máy dev. Không pm2, không launchd, không cron | |

**Deploy production = `bash ops/deploy/from-mac.sh` TỪ MÁY MAC.** `git pull` trên VPS không chạy
được (không có khoá GitHub) và vẫn in `origin/main` cũ nên trông như đã mới nhất.
`npm run build` ở Mac chỉ đổi bản localhost, không phải deploy. **Đừng đưa `kho-postgres` lên
`main` rồi deploy khi VPS chưa có Postgres.**

## 2. Rule chỉ số BẮT BUỘC (CEO đã duyệt — sai = số bậy)

1. **Doanh thu** = `SUM(cod ÷ SỐ CHIA CỦA SHOP × tỷ giá)` WHERE `status_category='GIAO_THANH_CONG'
   AND cod>0`. KHÔNG dùng `total_price`. "GTC hôm nay ≈ 0" là ĐÚNG (COD trễ), không phải bug.
   ⚠️ **Số chia KHÔNG phải lúc nào cũng 100**: Đài, Nhật lưu **NGUYÊN tiền** (cod=950 ⇒
   950 TWD) → ÷1; Singapore, UAE ÷100. Gõ `/100` cứng = tiền tụt đúng 100 lần (đã dính 20/08,
   AOV ra 8.987đ). Bảng số chia: `config/talpha_rules.json → markets.*.pos_money_divisor`, đọc qua
   `posMoneyDivisor()`. Thêm shop mới: lấy đơn thật từ POS API so với giá bán thật rồi mới khai.
2. **Tỷ giá → VND**: TW 800 · SG 20.000 · AE 7.000 · JP 160. Khai ở `talpha_rules.json →
   markets.*.rate_vnd`; sửa / thêm nước trên `/admin` → Thị trường (bảng `market_overrides` phủ lên file).
3. **Chi phí quảng cáo ĐÃ là VND** (không ÷100, không quy đổi). Cột `date`, không phải `date_start`.
   Chi tiêu gán về nước bằng **ô đầu tên campaign** (`TW` · `SG` · `AE` · `JP`).
4. **Marketer của đơn** — rule 3 bậc: (a) tag POS (`marketer.$.name`);
   (b) không tag/ngoài team → camp nối theo nguồn đơn / `ad_id` → chủ campaign; (c) vẫn không →
   "(không gán)". KHÔNG bỏ đơn lặng lẽ. Chạy lấn nước → số tính cho người cầm nước đó.
5. **Đếm đơn bằng `order_uid`** (shop + id) — POS đánh số riêng từng shop.
6. **Timezone**: `inserted_at` là UTC. Báo cáo gom đơn theo VN+7; spend theo tz từng TKQC
   → **từng ngày lệch, cả tháng khớp**. Không phải bug.
7. **Campaign chứa từ "test"** (đứng riêng) → tách khỏi mọi báo cáo doanh số (Đài được miễn trừ).
8. Một TKQC chứa campaign của NHIỀU marketer và ngược lại — đừng coi tổng account =
   spend một người.

Văn bản đầy đủ: `docs/TALPHA_METRIC_RULES.md`.

## 3. Bẫy — đọc trước khi sửa code

1. **Chẩn đoán "số sai": KHÔNG BAO GIỜ so Sheet ↔ kho số** — cùng nguồn, cùng sai.
   Ground truth: spend = Meta API trực tiếp (`ops/talpha_reports/check_meta_token.py`);
   đơn = POS API live.
2. **Sheet lệch dashboard là CỐ HỮU** ở những màn còn tự tính từ kho số — sync theo giờ vs gọi
   live; tag POS vs `ad_id`; timezone từng TKQC vs ngày VN. Đừng "fix cho khớp" từng ngày.
3. **Ads Command Center dùng doanh thu ĐẶT, tab đọc kho số dùng GIAO THÀNH CÔNG** →
   ROAS hai nơi khác bản chất, không so trực tiếp.
4. **Không bao giờ xoá-trước-rồi-mới-fetch** — fetch chết giữa chừng là mất trắng (đã xảy ra
   06/07). Nhánh Postgres: raw chỉ thêm + bảng sạch dựng lại trong MỘT transaction
   (`sync/core/pg_writer.py`), cấm DELETE/DROP/TRUNCATE lên bảng dữ liệu. Production BigQuery gói
   miễn phí: KHÔNG streaming, KHÔNG DML — chỉ LOAD JOB.
5. **Vòng báo cáo không ghi khi sync hỏng** (chốt 03/09). Giữ số cũ đúng hơn là ghi đè bằng số
   thiếu — spend nằm ở mẫu số nên Sheet sai theo hướng **đẹp giả**.
6. **TKQC (nhánh Postgres)**: tự động — mọi TKQC các token Meta đọc được vào bảng `tkqc`;
   `fb_ads_data` / `fb_adset_data` / `fb_campaign_data` là **VIEW** chỉ gồm loại "vào báo cáo"
   (`talpha_rules.json → tkqc_loai`). Đừng ghi thẳng vào view. TKQC không nằm trong token nào đọc
   được = thiếu spend âm thầm. (Production BigQuery vẫn theo danh sách khai tay.)
7. **Luật thị trường có BA bản đọc** (TS `lib/talpha/market-config.ts`, Python `sync/core/market_config.py`,
   bot `ops/zalo-alerts/market_config.js`) chạy chung fixture `tests/fixtures/market_overrides.json` —
   sửa luật phủ thì sửa cả ba.
8. **Bẫy Unicode tên**: POS lưu "Chu Thuý" (sắc trên Y) ≠ "Thúy" — match bằng `"THU"`.
9. **Nhật không có số tin nhắn trên Meta** (luật Nhật) — mess Nhật đếm từ Pancake.
10. Chi tiết đầy đủ: `references/landmines.md`.

## 4. Thao tác vận hành

Thêm TKQC, chữa số thiếu, re-sync tay, xử lý lock kẹt, vị trí log — `references/runbook.md`.

## 5. Tài liệu gốc trong repo

- `DASHBOARD_MAP.md` — bản đồ nghiệp vụ, đọc trước tiên
- `CLAUDE.md` — hướng dẫn làm việc, nguyên tắc cứng
- `docs/TALPHA_METRIC_RULES.md` — rule chỉ số + quy trình chẩn đoán (source of truth)
- `docs/POSTGRES.md` — kho số Postgres, docker compose, bảng dịch SQL BigQuery → Postgres
- `docs/DEPLOY_VPS.md` — dựng và cập nhật máy chủ (production)
- `docs/COD_RECONCILIATION.md` — nghiệp vụ đối soát COD
- `docs/CAMPAIGN_NAMING.md` — quy ước tên campaign (quyết định gán marketer)
- `docs/ZALO_BOT.md` — bot Zalo
