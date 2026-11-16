# TALPHA — Rule chỉ số Ads & Đơn hàng (source of truth)

> Viết lại 11/09/2026 khi còn **một thị trường Đài Loan**; nay bán ở **bốn nước** — Đài Loan,
> Singapore, UAE (từ 15/09/2026), Nhật Bản (từ 08/10/2026). Đọc file này TRƯỚC khi sửa
> bất cứ gì liên quan báo cáo Sheet / dashboard / sync. Rule đổi thì cập nhật file này.
>
> Kho số: nhánh `kho-postgres` (04/11/2026) là **Postgres** (`docs/POSTGRES.md`); production
> (`main`, VPS) vẫn BigQuery. Công thức chỉ số giống nhau ở hai bản; chỗ nào khác ghi rõ.
>
> **Rule máy-đọc-được** nằm ở `config/talpha_rules.json` — file .md này giải thích
> VÌ SAO, file .json là cái code đọc. Sửa rule → sửa .json trước, đừng gõ lại vào code.
>
> Bản đồ hệ thống (cái gì chạy ở đâu): `DASHBOARD_MAP.md`.

## 1. Dòng dữ liệu

```
Meta API ──┐
           ├─ sync :00 mỗi giờ ─► kho số (Postgres) ─┬─ /api/query ────► tab báo cáo
POS Poscake┘                                         │
             vòng báo cáo :20 ───────────────────────┴─ format_all.py ─► bảng bao_cao_tab
                                                        (+ Google Sheets nếu có khoá Google)

Meta API + POS ──live──► /api/talpha/realtime  ─► Ads Command Center
POS            ──live──► /api/talpha/inventory ─► tab Sản phẩm & Kho
```

**Engine sync chỉ có MỘT bản**: `sync/talpha/talpha_sync.py` + `sync/core/*`.
Trước 11/09/2026 có bản thứ hai dưới `~/talpha_reports/runtime/sync/`, và hai timer
nạp hai bản khác nhau vào cùng một bộ bảng BigQuery mỗi giờ — bản nào chạy sau thì đè
bản kia. `sync_month.py` nay dừng lại nếu nạp nhầm bản. **Đừng chép engine đi đâu nữa.**

### 1.1 Rule dùng chung — một file JSON, ba module

`config/talpha_rules.json` chứa: marketer + biến thể tên · thị trường & tỷ giá · alias ·
status GTC · pattern campaign test · phí 3PL · giá vốn SKU · ngưỡng ROAS · luật đối soát.

| Module | Ngôn ngữ | Ai dùng |
|---|---|---|
| `dashboard-ui/src/lib/talpha/rules.ts` | TS | route dashboard, `talpha/inventory.ts`, prompt CEO-ask |
| `ops/talpha_reports/talpha_rules.py` | Python | `format_all.py` |
| `ops/zalo-alerts/rules.js` | JS | bot Zalo |

TS và Python cùng expose `attribute_order`/`attributeOrder` (rule CEO ba bậc), `parse_campaign`,
`build_adid_owner`, `shipping_vnd`. Đối chứng 03/08 trên data thật (khi đó bản JS là của bot WhatsApp,
đã xoá 30/10/2026): Python ≡ TS ≡ JS. Bot Zalo đọc cùng file JSON nhưng chỉ có phần nó cần (chủ camp
`chuCamp`, người cầm nước `chuTinhSo`, nước của camp `campaignMarket`).

Đường dẫn tới file cấu hình: phía TS hỏi `lib/talpha/config-path.ts`, đừng tự ghép
`process.cwd()`. Bản sao `dashboard-ui/config/` đã xoá 11/09 — nó từng lệch thật
(giữ shop_id Đài cũ `1328343252` trong khi bản chuẩn lúc đó là `408074608` — nay là `1022091930`).

## 2. Rule từng chỉ số

| Chỉ số | Sheet (`format_all.py`) | Dashboard (`realtime/route.ts`) |
|---|---|---|
| **Nguồn spend / tin nhắn** | Kho số `fb_ads_data` (sync mỗi giờ; nhánh Postgres là VIEW chỉ TKQC loại vào báo cáo). Nhật: mess đếm từ Pancake | Meta API live |
| **Gán spend → marketer** | `parse_campaign`: tìm segment thị trường, segment NGAY SAU là tên marketer; bảng biến thể ở `talpha_rules.json → camp_marketer_tokens` | Nhóm theo TKQC/campaign; bot dùng `scanCampaignMarketer` quét cả tên camp |
| **Sản phẩm của campaign** | Ô thứ HAI sau ô marketer (ô ngay sau là tệp khách), ô thứ ba là tên trang — cả tên có lẫn không có ô nước. Camp `TEST` tách tab theo trang. Code: `camp_san_pham` | Bot Zalo cùng luật (`tenNganCamp`) |
| **Ngày của spend** | Ngày theo **timezone TKQC** (Meta trả sẵn) — múi giờ thật của từng TKQC lấy từ Meta API (nhánh Postgres: cột múi giờ của bảng `tkqc`; `talpha.yaml → ad_account_timezones` chỉ là dự phòng cho TKQC cũ), KHÔNG đoán theo tên | Cùng |
| **Tin nhắn** | action `onsite_conversion.messaging_conversation_started_7d` | Cùng |
| **Nguồn đơn** | Kho số `sale_order`. Đơn bị **xoá trên POS** tự rời bảng ở vòng sync kế tiếp (dòng đánh dấu trong `sale_order_raw`, không xoá dữ liệu — xem `DA_XOA_TREN_POS` trong `sync/core/pg_writer.py`) | Hybrid: kho số (≥2 ngày trước) + POS API live (hôm qua/nay) |
| **Đơn trống** | Đơn **không sản phẩm, tổng tiền 0, cod 0** KHÔNG tính vào số đơn (Sỹ Anh chốt 17/09/2026 — tháng 9 shop Đài 87 đơn trống, toàn đơn không tag marketer, làm số đơn thổi lên ~4 lần). Log mỗi vòng in `BO DON TRONG`. Đơn được điền sản phẩm sau đó tự tính lại. Code: `la_don_trong`, `sql_is_empty_order` | Chưa áp |
| **Gán đơn → marketer** | Rule CEO: 1) TAG trong POS (`marketer.$.name`); 2) không tag → chủ **campaign nối theo nguồn đơn** (dòng dưới), trượt thì chủ campaign của `ad_id`/`adset_id`; 3) vẫn không → tab **"(không gán)"**. KHÔNG bỏ đơn lặng lẽ | `ad_id` → ad; không khớp thì fallback `marketer+market+page_id` (chỉ khi khoá trỏ đúng một campaign); vẫn không → "chưa map" kèm lý do |
| **Nối đơn → campaign** (sản phẩm, marketer, tiền ads) | **Theo NGUỒN ĐƠN** — Sỹ Anh chốt 17/09/2026: đơn POS → cột "Nguồn đơn" (tên page, đồng bộ vào `sale_order.page_name`) → khớp ô tên page trong tên camp Meta → camp đó. Khớp theo thứ tự: trùng tên → tên camp bắt đầu bằng tên page (ngày dính vào tên) → tên page nằm lệch ô. Page nhiều camp → quảng cáo của chính đơn → camp tiêu tiền trên page đúng ngày đơn về (thiếu thì ngày gần nhất trước đó) → camp tiêu nhiều nhất. Không nối được → theo `ad_id`/`adset_id`; vẫn không có marketer thì vào tab **"(không gán)"**. Log mỗi vòng in dòng `NOI NGUON DON` đếm số đơn theo từng cách khớp. Sale = `assigning_seller` trên POS (`sale_order.seller_name`). Code: `tim_camp_theo_page` | Chưa dùng |
| **Tab trong file riêng từng người** | **Mỗi PAGE một tab, đặt theo tên page** (Sỹ Anh chốt 17/09/2026). Tên theo cách viết trên POS (cột Nguồn đơn) để tiền ads của camp và đơn của page vào cùng tab: camp dò ô tên page sang tên page POS (trùng → đầu tên → lệch ô; nhiều tên khớp lấy tên dài nhất). Page chưa có đơn trên POS: tên trong camp, cắt đuôi ngày dính (" - 25"), biến thể gộp về tên ngắn nhất. Đơn không ghi nguồn: tab page của camp theo quảng cáo, không có → `(khác)`. Page 0 tiền, 0 tin nhắn, 0 đơn trong tháng: không có tab. Code: `tao_ten_tab_page`, `ten_tab_cua_don` | Không có tab |
| **Ngày của đơn** | **VN +7** (`Asia/Ho_Chi_Minh`) | Đơn đã match: theo tz TKQC; chưa match: VN +7 |
| **Doanh số** | `cod ÷ số chia của shop × tỷ giá`. Đài Loan: **số chia 1**, tỷ giá **800đ/TWD**. Singapore: **số chia 100**, tỷ giá **20.000đ/SGD** (số chia Singapore và UAE đã đo trên đơn thật).
Tỷ giá sửa / nước thêm trên `/admin` → Thị trường (bảng `market_overrides`) phủ lên file. UAE: **số chia 100**, tỷ giá **7.000đ/AED**. Nhật: **số chia 1** (lưu nguyên yên, đã đo), tỷ giá **160đ/JPY**. Nước chưa khai tỷ giá thì doanh thu 0, không đoán. Giá vốn = `products.*.cost_price_rmb × cost_rate_rmb_vnd` (3.860). Nguồn: `talpha_rules.json → markets` (`pos_money_divisor` + `rate_vnd`) | Cùng |
| **DS Giao TC** | `status_category = 'GIAO_THANH_CONG'` | Cùng |
| **Danh sách TKQC** | Nhánh Postgres: **tự động** — mọi TKQC các token Meta đọc được, bảng `tkqc`; chỉ loại "vào báo cáo" (`talpha_rules.json → tkqc_loai`, đổi ở `/admin` → TKQC) cộng vào số. Production: danh sách khai tay | Cùng bảng `tkqc` |
| **Campaign TEST** | Campaign chứa từ `test` đứng riêng → tách khỏi báo cáo doanh số, gom vào file `[Test] Ads - <tên>`. **Đài Loan được miễn trừ** (`test_campaign.exempt_markets`) — tên campaign TW hay chứa "test" theo nghĩa khác | Chưa tách (dashboard là màn vận hành, hiện đủ camp) |
| **Phí 3PL** | Mỗi nước một khối `talpha_rules.json → shipping_fees.<mã nước>`. Đài: `shipping_fees.TW` — NAZA供应链, tính bằng RMB theo kênh giao (7-Eleven/FamilyMart 27 · HCT 32 · Yamato 38 RMB cho kg đầu; sau đó 15 RMB/kg dưới 3kg, 19 RMB/kg trên 3kg) + 3 RMB/đơn phí thao tác | Cùng module (`shippingVnd`) |

### ⚠️ Số chia tiền POS — bẫy đắt nhất

`cod` trong POS **không phải lúc nào cũng là minor units**. Shop Đài lưu **nguyên TWD**
(`cod=950` ⇒ 950 TWD, đã verify bằng POS API 20/08) nên số chia là **1**. Gõ `/100` cứng
là doanh thu tụt đúng 100 lần — AOV ra 8.987đ/đơn, đủ vô lý để thấy ngay, nhưng lúc đó
số đã lên Sheet rồi.

Dùng `posMoneyDivisor()` (TS) hoặc bảng `markets.*.pos_money_divisor` (Python). Thêm
shop mới: lấy một đơn thật từ POS API, so với giá bán thật, rồi mới khai.

> Ghi chú lịch sử: sáu shop GCC cũ (SA/AE/KW/OM/QA/BH) lưu minor units nên số chia là
> 100. Chúng đã ngừng bán từ 05/09/2026 và không còn trong config. Mặc định của
> `posMoneyDivisor()` vẫn là 100 cho shop_label lạ — cố ý giữ, nhưng nghĩa là gõ sai
> tên shop sẽ chia nhầm 100. Khai đúng tên, đừng dựa vào mặc định.

## 3. Lệch CỐ HỮU giữa Sheet và dashboard (không phải bug)

1. **Độ trễ**: Sheet đọc bản sync gần nhất (mỗi giờ); Ads Command Center gọi live →
   cùng thời điểm số khác nhau vài phần trăm.
2. **Ngày ads ≠ ngày đơn**: spend theo ngày timezone TKQC, đơn theo ngày VN.
   **Từng NGÀY lệch, cả THÁNG khớp.** Đừng so CPO/ROAS theo ngày của TKQC lệch múi giờ
   với cảm nhận theo ngày VN.
3. **Gán đơn**: Sheet theo tag POS; dashboard ưu tiên `ad_id`. Lệch nhỏ với marketer có
   tag đầy đủ, lệch to với đơn không tag.
4. **Hai định nghĩa doanh thu**: tab đọc kho số đếm đơn GIAO THÀNH CÔNG; Ads Command
   Center đếm đơn ĐÃ ĐẶT. ROAS hai nơi không so trực tiếp được.

## 4. Vì sao sync không bao giờ xoá trước rồi mới ghi

Ngày 06/07/2026 ba sự cố cùng một cơ chế: **xoá trước, fetch sau, chết giữa chừng**.

| Sự cố | Hậu quả | Đã sửa thế nào |
|---|---|---|
| Sync ads timeout 60s + dính rate limit → 0 dòng | Mất 61 triệu spend | Retry + backoff, timeout 90s, account lỗi thì RAISE chứ không ghi |
| Sync đơn reset ở trang 11 → 100/2.210 đơn | `sale_order` thủng ~900 đơn, Sheet tụt 489→168 đơn | Retry trang ×5, shop lỗi thì RAISE; bỏ DROP-trước trong `sync_month.py`; ghi WRITE_TRUNCATE atomic |
| Thiếu 2 TKQC trong yaml | Undercount ~65 triệu | Thêm vào danh sách |

**Pattern xoá-trước-rồi-mới-fetch bị CẤM** (`bq rm` thời BigQuery; `DELETE` / `DROP` / `TRUNCATE`
trên Postgres). Fetch hỏng thì bảng cũ còn nguyên — số cũ nhưng đúng, exit code khác 0 để soi log.

Sau sự cố X1 / X2 (04–05/08/2026) bảng đơn, dòng hàng và quảng cáo ghi hai tầng: `<bảng>_raw` **chỉ
thêm**, bảng sạch dựng lại từ raw. Nhánh Postgres làm cả hai bước trong **MỘT transaction**
(`sync/core/pg_writer.py`) — lỗi giữa chừng là mọi thứ quay về như trước.

## 5. Vì sao sync hỏng thì KHÔNG ghi Sheet

Chốt 03/09/2026. Token Meta chết lúc 11:50, `fb_ads_data` đứng từ 10:36. Vòng chạy vẫn
trả rc=1 và vẫn in "ADS FAIL", nhưng `format_all.py` chạy vô điều kiện ngay sau đó nên
mỗi giờ lại ghi spend THIẾU xuống Sheet dưới dạng số 0 — không phân biệt được với
"không tiêu đồng nào".

Spend nằm ở **mẫu số**, nên Sheet sai theo hướng **đẹp giả**: CPO 103.735đ khi thật
~165.000đ, %Ads/DT 11,98% khi thật ~19%. Bảng ĐỨNG chứ không MẤT dòng nên
`report_account_health` vẫn báo "ok". **46 tiếng không ai nghi**, tới lúc CEO nhìn Sheet
thấy số đẹp bất thường mới lộ.

Nay `daily_guarded.sh` bỏ qua bước ghi Sheet khi sync rc≠0. Một Sheet cũ toàn phần đọc
được, còn Sheet nửa mới nửa thiếu thì không. Chạy tay có chủ đích:
`TALPHA_FORCE_FORMAT=1 ./daily_guarded.sh`.

## 6. Quy trình chẩn đoán "số sai" (làm theo thứ tự, đừng đoán)

1. **Ground truth**: spend = Meta API (`level=campaign, time_increment=1`); đơn = POS API
   live. **KHÔNG BAO GIỜ** kết luận đúng/sai bằng cách so Sheet với kho số — chúng cùng
   nguồn nên cùng sai.
2. Token Meta còn sống không: `python3 ops/talpha_reports/check_meta_token.py`
   (exit 0 = mọi TKQC đọc được).
3. So Meta ↔ `fb_ads_data` theo account: lệch >2% → sync ads hỏng.
   `journalctl -u talpha-sync -n 60 --no-pager` (VPS) hoặc `docker compose logs lich` (docker) —
   tìm "Read timed out" / "request limit". `/api/talpha/sync-health` trả TKQC / shop đọc lỗi.
4. So POS live ↔ `sale_order` theo marketer/ngày: lệch → sync đơn hỏng (tìm "chết ở page").
5. Dấu hiệu kinh điển:
   * ngày có ĐƠN nhưng 0 SPEND → sync ads mất account hoặc mất ngày;
   * đơn tụt đột ngột so với sáng → sync đơn ghi đè bằng bộ thiếu;
   * mọi chỉ số đẹp lên bất thường → kiểm mẫu số trước, thường là spend thiếu.
6. Trạng thái vòng chạy gần nhất:
   `tail -40 /root/talpha_reports/daily_$(date +%Y%m%d).log` trên VPS,
   `ops/talpha_reports/daily_$(date +%Y%m%d).log` trong repo khi chạy bằng docker compose, hoặc
   `ops/talpha_reports/report_health.py`.
