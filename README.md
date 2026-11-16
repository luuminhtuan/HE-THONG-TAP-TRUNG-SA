# TALPHA — Hệ thống tập trung

Dashboard vận hành cho đội ANTALO (Tiểu Alpha): bán trang sức và mỹ phẩm qua Facebook Ads
+ chat-sale + COD ở **bốn nước** — Đài Loan, Singapore, UAE (từ 15/09/2026) và Nhật Bản
(mở 08/10/2026). Mỗi nước một shop POS Poscake, một team riêng; tài khoản quảng cáo Meta
tự động (mọi TKQC các token Meta đọc được).

| Tài liệu | Đọc khi |
|:--|:--|
| [CLAUDE.md](CLAUDE.md) | Trước khi sửa code — cách chạy, kiến trúc, nguyên tắc cứng |
| [DASHBOARD_MAP.md](DASHBOARD_MAP.md) | Bản đồ nghiệp vụ: tiền đi đường nào, số trên màn hình từ đâu |
| [docs/TALPHA_METRIC_RULES.md](docs/TALPHA_METRIC_RULES.md) | Công thức chỉ số (source of truth) |
| [docs/POSTGRES.md](docs/POSTGRES.md) | Kho số Postgres, docker compose, bảng dịch SQL BigQuery → Postgres |
| [docs/](docs/) | Đối soát COD, quy ước tên campaign, bot Zalo, dựng máy chủ |

> **Hai bản đang song song.** Nhánh `kho-postgres` (04/11/2026) dùng kho số Postgres, chạy cả hệ
> thống bằng `docker compose`. **Production — nhánh `main` trên VPS `139.180.131.21` — vẫn chạy
> bản BigQuery.** Đừng đưa nhánh Postgres lên `main` rồi deploy khi máy chủ chưa có Postgres.

---

## Kiến trúc (nhánh `kho-postgres`)

| Phần | Ở đâu |
|:--|:--|
| Giao diện + API | Next.js 16 App Router + React 19 + TailwindCSS — `dashboard-ui/`, không có backend riêng |
| Kho số | Postgres (`DATABASE_URL`): bảng ở `db/migrations/`, view ở `db/views/` |
| Kéo số | `sync/talpha/talpha_sync.py` + `sync/core/` — đơn POS + chi tiêu Meta mỗi giờ |
| Báo cáo tháng | `ops/talpha_reports/format_all.py` → bảng `bao_cao_tab` (+ file Google Sheet nếu có khoá Google) |
| Bot Zalo | `ops/zalo-alerts/` — mỗi nước một nhóm, tin ads + vận đơn |
| Luật nghiệp vụ | `config/talpha_rules.json` — tỷ giá, số chia tiền POS, marketer, phí 3PL, giá vốn, phân quyền |
| Việc nền | Docker: `ops/docker/scheduler.py`. Production: systemd timer trên VPS |

## Chạy

Cần Docker Desktop.

```bash
docker compose up -d        # Postgres + dashboard http://localhost:3200 + lịch việc nền
```

Mở http://localhost:3200/admin → **Khoá kết nối**: dán token Meta, key POS từng nước. Máy gọi thử
khoá rồi mới lưu (mã hoá trong Postgres); việc nền tự kéo số từ giờ kế tiếp. Chi tiết:
[docs/POSTGRES.md](docs/POSTGRES.md).

## Kiểm tra trước khi commit

```bash
cd dashboard-ui && npm test && npx tsc --noEmit      # logic đối soát, vận đơn, sổ đơn + kiểm kiểu
cd ops/zalo-alerts && npm test                       # bot Zalo
DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \
  TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/   # rule nghiệp vụ + cách ghi số
```

Phải truyền `TALPHA_RULES` — thiếu là test Python đọc nhầm luật của hệ thống cũ còn nằm ở
`~/talpha_reports/` trên máy Mac. Code Python cần 3.10+.

## Deploy production

Từ máy Mac, nhánh `main` — xem [CLAUDE.md](CLAUDE.md) mục *Deploy* và
[docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md). `npm run build` ở máy Mac **không phải** deploy.

---

## Màn hình

| Nhóm | Tab |
|:--|:--|
| 📋 Báo cáo | Tổng quan · P&L · P&L theo SP |
| 🧾 Đơn hàng | Sổ đơn hàng · Theo dõi vận đơn |
| 💼 Kế toán | Lãi lỗ · Tiền COD về · Thanh toán quảng cáo |
| 📦 Sản phẩm | Sản phẩm & Kho |
| 👤 Marketer | Marketing & Ads |
| 🎯 Quảng cáo | Chi phí quảng cáo · Ads Command Center · Sức khoẻ quảng cáo |
| 👥 Khách hàng | Khách hàng · Market Intel |
| 🤖 Hỏi AI | Hỏi AI (chỉ giám đốc) |

Ngoài ra `/admin`: người dùng, TKQC, thị trường, khoá kết nối. Mỗi tab một địa chỉ `/talpha/<slug>`;
phân quyền theo team chặn ở máy chủ (`dashboard-ui/src/proxy.ts`). Chi tiết từng tab và số lấy từ
đâu: [DASHBOARD_MAP.md](DASHBOARD_MAP.md) mục 4.

---

## Cấu trúc

```
dashboard-ui/         Next.js 16 + React 19 — toàn bộ giao diện và API
  src/app/api/talpha/   route nghiệp vụ
  src/lib/talpha/       luật gán người, logic đối soát, vận đơn, sổ đơn (hàm thuần, có test)
config/               talpha_rules.json — NGUỒN LUẬT DUY NHẤT
db/migrations/        bảng Postgres (chạy theo thứ tự, chỉ thêm file mới)
db/views/             view phân tích — luật đúc vào lúc dựng (sync/core/pg_view.py)
sync/                 engine kéo số POS + Meta → Postgres (bản DUY NHẤT)
ops/docker/           lịch việc nền khi chạy bằng docker compose
ops/talpha_reports/   vòng báo cáo tháng + Google Sheets
ops/zalo-alerts/      bot Zalo
ops/deploy/ · ops/pm2/  dựng và cập nhật máy chủ VPS (production)
ads-reconciliation-cli/  bản dòng lệnh của đối soát chi phí quảng cáo (engine dùng chung với dashboard)
tests/                test Python
docs/                 tài liệu nghiệp vụ và vận hành
```

---

## Ba rule dễ tính sai nhất

1. **Doanh thu** = tổng `cod ÷ số chia của shop × tỷ giá`, chỉ đơn `GIAO_THANH_CONG` và `cod > 0`.
   Đài và Nhật lưu **nguyên tiền** nên số chia là **1**; Singapore, UAE là 100. Gõ `/100` là
   tiền tụt đúng 100 lần — dùng `posMoneyDivisor()`.
2. **Chi phí quảng cáo đã là VND** — không quy đổi thêm lần nào. Cột ngày là `date`,
   không phải `date_start`.
3. **Chẩn đoán số sai: không bao giờ so Sheet với kho số** — cùng nguồn nên cùng
   sai. Đối chiếu thẳng Meta API cho chi phí và POS API cho đơn.

---

## Còn nợ

Xem mục 10 của [DASHBOARD_MAP.md](DASHBOARD_MAP.md), và `config/talpha_rules.json → _todo`.
