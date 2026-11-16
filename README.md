# TALPHA — Hệ thống tập trung

Dashboard vận hành cho đội ANTALO (Tiểu Alpha): bán qua Facebook Ads → chat-sale → thu COD ở **5 nước**
— Đài Loan, Singapore, UAE (từ 15/09/2026), Nhật Bản (mở 08/10/2026), Việt Nam (mở 11/11/2026). Mỗi nước
một shop POS Poscake, một team riêng; tài khoản quảng cáo Meta tự động (mọi TKQC các token Meta đọc được).

| Tài liệu | Đọc khi |
|:--|:--|
| [CLAUDE.md](CLAUDE.md) | Trước khi sửa code — cách chạy, kiến trúc, nguyên tắc cứng |
| [DASHBOARD_MAP.md](DASHBOARD_MAP.md) | Bản đồ nghiệp vụ: tiền đi đường nào, số trên màn hình từ đâu |
| [docs/TALPHA_METRIC_RULES.md](docs/TALPHA_METRIC_RULES.md) | Công thức chỉ số (source of truth) |
| [docs/POSTGRES.md](docs/POSTGRES.md) | Kho số Postgres, docker compose, bảng dịch SQL BigQuery → Postgres |
| [docs/](docs/) | Đối soát COD, quy ước tên campaign, bot Zalo, dựng máy chủ |

> **Bản Postgres** (`main` từ 16/11/2026): máy dev chạy bằng `docker compose`; **máy chủ VPS `139.180.131.21` chạy bản
> này từ tối 16/11/2026** (Postgres có sẵn của máy + pm2 + systemd — `docs/DEPLOY_VPS.md`). Bản BigQuery cuối: nhánh
> `bk_main_26_11_16`.

---

## 1. Năm thị trường

| Nước | Tiền (tỷ giá) | Shop POS | Giao hàng | Người cầm | Team |
|:--|:--|:--|:--|:--|:--|
| Đài Loan | TWD (800đ) | Đài | NAZA供应链 + 17TRACK | Sỹ Anh | Đông Á |
| Nhật Bản | JPY (160đ) | Nhật | NAZA + Japan Post (17TRACK) | Sỹ Anh | Đông Á |
| Singapore | SGD (20.000đ) | Singapore | 3PL Sing (bảng đối tác) | Thái | Đông Nam Á |
| UAE | AED (7.000đ) | UAE | D&T Fulfillment / WeShip | Lộc | Trung Đông |
| Việt Nam | VND | "VIỆT NAM" (hạt giống) | J&T, đọc thẳng từ đơn POS | — | Việt Nam |

Mọi con số này khai ở `config/talpha_rules.json` (`markets`, `access.teams`, `shipping_fees`); tỷ giá, bật /
tắt nước sửa được ở `/admin` → Thị trường (phủ lên file, lưu trong Postgres).

## 2. Luồng của một đơn hàng

```
Facebook Ads ─► khách nhắn tin (Pancake / Botcake) ─► sale chốt đơn trên POS Poscake
                                                            │
                          ┌─────────────────────────────────┼──────────────────────────┐
                          ▼                                 ▼                          ▼
                 3PL nhận và giao hàng              theo dõi hành trình          POS đổi trạng thái
              (NAZA · 3PL Sing · D&T · J&T)      (17TRACK · WeShip · POS J&T)     đã giao / hoàn
                          │                                 │                          │
                          ▼                                 ▼                          ▼
               khách trả tiền cho shipper          tab Theo dõi vận đơn        sync mỗi giờ → Postgres
                          │                        + tin Zalo vận đơn                  │
                          ▼                                                            ▼
               3PL chuyển tiền theo kỳ ─► tab Tiền COD về ◄── khớp mã vận đơn ──► Sổ đơn hàng
```

## 3. Ba đường số chảy vào dashboard

| Đường | Từ đâu → tới đâu | Dùng cho |
|:--|:--|:--|
| **Chốt số** (mỗi giờ) | Meta API + POS + bảng đơn đối tác → Postgres → bảng `monthly_report_tabs` "TỔNG TEAM" (+ file Google Sheet nếu có khoá Google) | Tổng quan, P&L, Marketer, Lãi lỗ, tin Zalo |
| **Tức thời** | Meta API + POS gọi thẳng | Ads Command Center, Sản phẩm & Kho |
| **File tải lên / nhập tay** | Sao kê 3PL, sao kê thẻ, chi phí vận hành, kỳ J&T Việt Nam → bảng `app_documents` | Tiền COD về, Thanh toán quảng cáo, Lãi lỗ |

"TỔNG TEAM" là **một nguồn chung** cho dashboard, file Sheet và bot Zalo, nên ba nơi luôn cùng số.

---

## Kiến trúc

| Phần | Ở đâu |
|:--|:--|
| Giao diện + API | Next.js 16 App Router + React 19 + TailwindCSS — `dashboard-ui/`, không có backend riêng |
| Kho số | Postgres (`DATABASE_URL`): bảng ở `db/migrations/`, view ở `db/views/` |
| Kéo số | `sync/talpha/talpha_sync.py` + `sync/core/` — đơn POS + chi tiêu Meta mỗi giờ |
| Báo cáo tháng | `ops/talpha_reports/format_all.py` → bảng `monthly_report_tabs` (+ file Google Sheet nếu có khoá Google) |
| Bot Zalo | `ops/zalo-alerts/` — mỗi nước một nhóm, tin ads + vận đơn; ghép nick, chọn nhóm ở `/admin` → Khoá kết nối → Zalo |
| Luật nghiệp vụ | `config/talpha_rules.json` — tỷ giá, số chia tiền POS, marketer, phí 3PL, giá vốn, phân quyền |
| Việc nền | Docker: service `scheduler` (`ops/docker/scheduler.py`). Production: systemd timer trên VPS |

## Chạy

Cần Docker Desktop.

```bash
docker compose up -d --remove-orphans   # Postgres + dashboard http://localhost:3200 + lịch việc nền
```

`--remove-orphans`: service lịch tên `scheduler` (trước 16/11/2026 là `lich`) — máy từng chạy bản cũ mà thiếu cờ
này thì container lịch cũ vẫn chạy song song và kéo số hai lần mỗi giờ. Máy có DB dựng bằng code kho-postgres
(trước 16/11/2026) phải sao lưu rồi dựng lại DB: `docs/POSTGRES.md` → "Chuyển từ kho-postgres".

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

### Canh máy chủ từ máy Mac

Bot Zalo nằm cùng máy chủ nên máy chủ đứng là không ai được báo. Máy Mac gọi trang đăng nhập 5 phút một
lần (launchd `vn.antalo.watch-server`); hỏng 2 lượt liền thì bật hộp thoại + thông báo, lên lại thì báo lần
nữa. Mac tắt / ngủ thì không canh.

- Cài: `bash ops/mac-watch/install.sh` · Gỡ: `bash ops/mac-watch/install.sh --uninstall` (bản cài tên cũ
  `vn.antalo.canh-may-chu` được gỡ tự động khi cài lại)
- Nhật ký: `~/.talpha-watch/watch.log`

---

## Màn hình

| Nhóm | Tab | Trả lời câu hỏi |
|:--|:--|:--|
| 📋 Báo cáo | Tổng quan · P&L · P&L theo SP | Bán được bao nhiêu, lãi gộp tạm tính |
| 🧾 Đơn hàng | Sổ đơn hàng · Theo dõi vận đơn | Đơn nào đang ở đâu, kiện nào kẹt |
| 💼 Kế toán | Lãi lỗ · Tiền COD về · Thanh toán quảng cáo | Lãi thật sau mọi khoản, tiền về đủ chưa |
| 📦 Sản phẩm | Sản phẩm & Kho | Còn hàng gì |
| 👤 Marketer | Marketing & Ads | Từng người chạy ra sao |
| 🎯 Quảng cáo | Chi phí quảng cáo · Ads Command Center · Sức khoẻ quảng cáo | Đang tiêu bao nhiêu, camp nào cần tắt |
| 👥 Khách hàng | Khách hàng · Market Intel · Tệp khách · Soi đối thủ | Khách mua lại, thị trường, tệp nên chạy, đối thủ bán gì |
| 🤖 Hỏi AI | Hỏi AI (chỉ giám đốc) | Hỏi số bằng câu thường |

Ngoài ra `/admin`: người dùng, TKQC, thị trường, khoá kết nối (cả bot Zalo). Mỗi tab một địa chỉ
`/talpha/<slug>`; phân quyền theo team chặn ở máy chủ (`dashboard-ui/src/proxy.ts`) — mỗi người chỉ thấy
nước của team mình, giám đốc thấy hết. Chi tiết từng tab và số lấy từ đâu: [DASHBOARD_MAP.md](DASHBOARD_MAP.md) mục 4.

---

## Cấu trúc

```
dashboard-ui/         Next.js 16 + React 19 — toàn bộ giao diện và API
  src/app/api/talpha/   route nghiệp vụ
  src/lib/talpha/       luật gán người, logic đối soát, vận đơn, sổ đơn (hàm thuần, có test)
config/               talpha_rules.json — NGUỒN LUẬT DUY NHẤT; customer_segments.json, competitor_research.json — số tham chiếu
db/migrations/        bảng Postgres (chạy theo thứ tự, chỉ thêm file mới)
db/views/             view phân tích — luật đúc vào lúc dựng (sync/core/pg_view.py)
sync/                 engine kéo số POS + Meta → Postgres (bản DUY NHẤT)
ops/docker/           lịch việc nền khi chạy bằng docker compose
ops/talpha_reports/   vòng báo cáo tháng + Google Sheets
ops/zalo-alerts/      bot Zalo
ops/jt_vn/            nạp kỳ đối soát J&T Việt Nam
ops/mac-watch/        canh máy chủ từ máy Mac
ops/deploy/ · ops/pm2/  dựng và cập nhật máy chủ VPS (production)
ads-reconciliation-cli/  bản dòng lệnh của đối soát chi phí quảng cáo (engine dùng chung với dashboard)
tests/                test Python
docs/                 tài liệu nghiệp vụ và vận hành
```

---

## Ba rule dễ tính sai nhất

1. **Doanh thu** = tổng `cod ÷ số chia của shop × tỷ giá`, chỉ đơn `GIAO_THANH_CONG` và `cod > 0`.
   Đài, Nhật và Việt Nam lưu **nguyên tiền** nên số chia là **1**; Singapore, UAE là 100. Gõ `/100` là
   tiền tụt đúng 100 lần — dùng `posMoneyDivisor()`.
2. **Chi phí quảng cáo đã là VND** — không quy đổi thêm lần nào. Cột ngày là `date`,
   không phải `date_start`.
3. **Chẩn đoán số sai: không bao giờ so Sheet với kho số** — cùng nguồn nên cùng
   sai. Đối chiếu thẳng Meta API cho chi phí và POS API cho đơn.

---

## Còn nợ

Xem mục 10 của [DASHBOARD_MAP.md](DASHBOARD_MAP.md), và `config/talpha_rules.json → _todo`.
