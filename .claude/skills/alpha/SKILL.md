---
name: alpha
description: >-
  Skill TỔNG CHỈ HUY dự án TALPHA — tóm tắt toàn hệ thống, trạng thái lộ trình
  P0/P1/P2 + sổ lỗi X, việc còn mở, và điều phối sang 3 skill con (talpha-system,
  section-workflow, fix-data-errors). LUÔN dùng khi user gõ "alpha", "/alpha", mở
  phiên mới hỏi "tình trạng dự án", "đang tới đâu rồi", "làm gì tiếp theo", "tiếp
  tục công việc", "tổng quan hệ thống", hoặc khi chưa rõ việc user giao thuộc skill
  nào. Đây là điểm vào mặc định của mọi phiên làm việc TALPHA.
---

# alpha — Tổng chỉ huy dự án TALPHA

## Hệ thống trong 6 dòng

TALPHA = vận hành + BI cho đội ANTALO bán trang sức/mỹ phẩm qua FB Ads + chat-sale + COD ở
**bốn nước**: Đài Loan, Singapore, UAE (từ 15/09/2026) và Nhật Bản (mở 08/10/2026). Mỗi nước một
shop POS Poscake; TKQC Meta tự động (bảng `tkqc`). Dashboard Next.js 16 + báo cáo tháng
(`format_all.py`, bảng `bao_cao_tab` + Google Sheet nếu có khoá) + bot Zalo mỗi nước một nhóm.
**Hai bản đang song song**: nhánh `kho-postgres` (04/11/2026) — kho số Postgres, chạy bằng
`docker compose up -d`; còn **production = nhánh `main` trên VPS `139.180.131.21` VẪN chạy BigQuery**
`cty-507710.TALPHA_Dataset`. Máy chủ kéo code từ GitHub `nhuquynh16091999-hash/HE-THONG-TAP-TRUNG-SA`
— tên remote trỏ tới repo đó khác nhau theo máy (`git remote -v` trước khi push).
Bản đồ nghiệp vụ đầy đủ: `DASHBOARD_MAP.md`. Hướng dẫn làm việc: `CLAUDE.md`.

## Điều phối — việc nào skill nấy

| Việc user giao | Skill | Ghi chú |
|---|---|---|
| Đụng số liệu/dashboard/sheet/bot/kho — BẤT KỲ | `talpha-system` | Đọc TRƯỚC khi sửa dòng code đầu tiên. Rule chỉ số CEO duyệt + bẫy chết người |
| Làm 1 hạng mục có mã (A1…F4) | `section-workflow` (`/section-workflow`) | Quy trình: git sạch → sửa → verify → 1 commit/section → push → deploy |
| "Số sai/thiếu/nhảy", lỗi mã X, cảnh báo sync-health | `fix-data-errors` (`/fix-data-errors`) | Chẩn đoán bằng ground truth TRƯỚC, sửa sau. Sổ lỗi X trong references |
| Chưa rõ thuộc loại nào | ở lại `alpha` | Đọc mục Trạng thái dưới đây rồi quyết |

## Kỷ luật bất di bất dịch (tóm từ 3 skill con — chi tiết ở đó)

1. **Ground truth** = Meta API (spend) + POS API (đơn). KHÔNG BAO GIỜ so Sheet ↔ kho số
   (BigQuery hay Postgres đều vậy — cùng nguồn nên cùng sai).
2. **1 section = 1 commit = push ngay**. Commit bằng pathspec `git commit -- <paths>`
   (index dùng chung giữa các phiên song song). CẤM `git reset HEAD~N`.
3. **Deploy production** = `bash ops/deploy/from-mac.sh` **TỪ MÁY MAC**, đẩy nhánh `main`. Máy chủ
   không có khoá GitHub, nó mượn khoá của Mac qua `ssh -A`; `git pull` thẳng trên máy chủ không
   chạy được mà vẫn in `origin/main` cũ nên trông như đã mới nhất. `npm run build` ở Mac chỉ đổi
   bản localhost, KHÔNG phải deploy. KHÔNG `git clean` trên `/opt/talpha` (xoá mất .env.local,
   key). **Đừng đưa `kho-postgres` lên `main` rồi deploy khi máy chủ chưa có Postgres.**
4. **Sync chỉ có MỘT bản**: `sync/talpha/talpha_sync.py` (gộp 11/09/2026). Đừng chép bản thứ
   hai sang runtime — trước đây hai bản cùng ghi một bộ bảng mỗi giờ.
5. **Không bao giờ xoá-trước-rồi-mới-fetch.** Nhánh Postgres: raw chỉ thêm + bảng sạch dựng lại
   trong MỘT transaction (`sync/core/pg_writer.py`), cấm DELETE/DROP/TRUNCATE lên bảng dữ liệu.
   Production BigQuery (gói miễn phí): cấm DML, ghi = LOAD JOB, sửa bảng = query→destination;
   mọi bảng đã chuyển raw/rebuild — KHÔNG quay lại WRITE_TRUNCATE.
6. Cảnh báo kêu nhiều KHÔNG phải lý do nới ngưỡng; số liệu mâu thuẫn với lời giải
   thích → lời giải thích sai.

## Trạng thái lộ trình

> Chốt lần cuối 05/08/2026 trên BigQuery, cập nhật mốc B1 11/09/2026. **Chưa soát lại sau khi
> chuyển Postgres (04/11/2026).** Trước khi báo cáo user, đo lại bằng phép đo trong
> `fix-data-errors/references/open-issues.md`, đừng chép nguyên đoạn này.

- **P0 (9 mục): ✅ 9/9** — đóng sổ 03/08.
- **P1 (8 mục): ✅ 8/8** — B1 (hợp nhất 2 bản sync) cutover xong 11/09/2026.
- **P2 (8 mục): ✅ 8/8** — A5, A6, B5, C2, D3, E2, F3, F4.
- **Sổ lỗi X**: X1 ✅ · X2 ✅ · X6 ✅ · X7 ✅ · X8 ✅ · X9 ✅ · X13 ✅ · X5 ✅ (E2: view đọc giá
  vốn từ rules file) · X4 xử lý ở tầng view (E2) — còn **X3** (phủ giá vốn, chờ user khai giá vốn).

## Việc đang mở — thứ tự ưu tiên

1. **X3 — giá vốn SKU** *(chưa soát lại sau khi chuyển Postgres)*. Giá vốn khai ở
   `config/talpha_rules.json → products`; đo % doanh thu có giá vốn trước khi báo. Bản cũ chờ user
   share Google Sheet giá vốn (`1MFV6X_Lppace2F7t8PX0MZwt6otWRmV-gbOdZBIC7Ak`) cho service account
   quyền Viewer — hỏi user đã xong chưa. Giá vốn sai = mọi số lãi sai — không tự đoán đơn vị tiền.
2. ~~**B1 cutover hai engine sync**~~ — **XONG 11/09/2026**. Chỉ còn
   `sync/talpha/talpha_sync.py`; `sync_month.py` nạp nó qua `$TALPHA_REPO` và dừng ngay nếu nạp
   nhầm bản khác.
3. **X4 — sku bẩn** trong `product_catalog`: đã chuẩn hoá ở tầng view (`db/views/00_vw_product_catalog_std.sql`,
   4 bậc bóc mã); bảng thô vẫn giữ sku gốc của POS. *Chưa soát lại sau khi chuyển Postgres.*
4. **`fb_campaign_tat_ca` (view `fb_campaign_data`)** — nhánh Postgres ghi bằng `replace_table` (thay cả
   bảng trong một transaction; 0 dòng thì giữ bảng cũ). Nhưng một TKQC lỗi bị bỏ qua (`continue`)
   rồi bảng vẫn bị thay → campaign của TKQC đó biến khỏi bảng tới vòng sau. Cùng họ lỗi X2, chưa sửa.
5. **F2 phần user**: Hỏi AI đã bật lại 15/11/2026 (khoá Gemini ở Khoá kết nối → tab Gemini). Việc
   thu hồi khoá Gemini cũ trên aistudio.google.com chưa rõ đã làm — hỏi user.

## Bài học đắt giá nhất (đủ ngắn để nhớ, chi tiết trong memory)

- **Ghi đè cả bảng bằng bộ vừa kéo là họ lỗi ăn dữ liệu số 1** (thời BigQuery là WRITE_TRUNCATE):
  X1 (đơn 3.960→69.775 sau fix), X2 (mất trắng tháng 7 ads), catalog E2 (xoá trắng vì thiếu .env).
  Khuôn chữa: append vào `*_raw` + dựng lại bảng — trên Postgres là `sync/core/pg_writer.py`.
- **`order_id` KHÔNG duy nhất giữa shop** (X8) — POS đánh số riêng từng shop,
  khoá đúng là `(shop_id, id)` / `order_uid`.
- **Schema raw phải lấy từ chính bảng raw** (X2) — thời BigQuery autodetect khi APPEND làm lệch kiểu.
- **Hạ tầng validation hỏng thì log vẫn in PASS/FAIL như thường** (B1 ×2 lần) —
  kiểm code clone + bước chạy + cỡ bảng shadow trước khi tin.
- **Đổi chữ ký hàm sync = grep hết nơi gọi** (`sync_month.py` và mọi script tay).
- **Luôn nêu mẫu số khi báo tỷ lệ** (`is_confirmed`? khung ngày nào?) — 2 phiên
  từng lệch 20,7% vs 3,4% chỉ vì mẫu số.

## Tài liệu gốc

- Sơ đồ cây + section: artifact "TALPHA — Sơ đồ hệ thống & Lộ trình tối ưu"
  (https://claude.ai/code/artifact/414e34de-d0f5-44df-a2e9-2ef21014343c)
- Rule chỉ số: `docs/TALPHA_METRIC_RULES.md` · Bản đồ nghiệp vụ: `DASHBOARD_MAP.md` · Kho số
  Postgres: `docs/POSTGRES.md`
- Danh mục section: `section-workflow/references/sections.md` · Sổ lỗi:
  `fix-data-errors/references/open-issues.md` · Vận hành: `talpha-system/references/runbook.md`

## Khi đóng xong một việc

Cập nhật: (1) sổ lỗi / sections.md tương ứng, (2) memory (file + MEMORY.md),
(3) mục "Trạng thái" + "Việc đang mở" của CHÍNH SKILL NÀY — alpha là bản đồ,
bản đồ sai còn tệ hơn không có bản đồ.
