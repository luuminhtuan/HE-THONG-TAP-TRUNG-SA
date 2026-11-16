---
name: fix-data-errors
description: >-
  Xử lý các LỖI SỐ LIỆU của TALPHA (sổ lỗi X: Smart Stop cắt cụt đơn, fb_ads_data mất
  tháng cũ, order_items thiếu giá, product_catalog bẩn, cogs_vnd chết, sale_order trùng
  id, order_id trùng giữa shop…). Quy trình chẩn đoán-trước-khi-sửa dựa trên ground
  truth Meta API / POS API. LUÔN dùng skill này khi user nói "xử lý P1", "làm X1",
  "/fix-data-errors" (tên cũ "/xu-ly-p1"), "sao số sai", "thiếu đơn/thiếu spend",
  "số nhảy", "báo cáo lệch", "COGS sai", "mất dữ liệu tháng trước", hoặc khi một cảnh
  báo sync-health kêu mà chưa rõ đúng/sai. Sửa code trước khi chẩn đoán = rủi ro bịt
  mất chính cái lỗi đang cần bắt (đã xảy ra với B5).
---

# fix-data-errors — Xử lý lỗi số liệu

## Skill này khác `section-workflow` chỗ nào

`section-workflow` dành cho việc **đã biết phải làm gì** (sửa file A, deploy B).
Skill này dành cho việc **chưa biết vì sao số sai** — phần lớn công sức nằm ở chẩn
đoán, và sửa sai chỗ thì tai hại hơn không sửa. Kỷ luật commit/push/deploy vẫn theo
`section-workflow` (1 section = 1 commit = push ngay); đừng chép lại, chỉ tuân theo.

## Đang chẩn đoán trên bản nào

| | Production | Nhánh `kho-postgres` (04/11/2026) |
|---|---|---|
| Kho số | BigQuery `cty-507710.TALPHA_Dataset` (VPS, nhánh `main`) | Postgres `DATABASE_URL` (`docker compose up -d`) |
| Query | Standard SQL, bảng có tiền tố dataset | Postgres — dịch theo bảng trong `docs/POSTGRES.md` |
| Log vòng chạy | `/root/talpha_reports/daily_<ngày>.log`, `journalctl -u talpha-sync` | `docker compose logs lich`, `ops/talpha_reports/daily_<ngày>.log` |

Sổ lỗi trong `references/open-issues.md` đo thời BigQuery (tháng 8/2026). Phép "Đo lại" đã có bản
Postgres đi kèm; mục nào ghi **chưa soát lại sau khi chuyển Postgres** thì đo lại trước khi tin.

## Ba luật cứng — vi phạm là hỏng việc

**1. Ground truth là API gốc, KHÔNG BAO GIỜ so Sheet ↔ kho số.**
Hai cái cùng nguồn, cùng sai. Spend đúng = Meta API trực tiếp
(`level=campaign, time_increment=1`). Đơn đúng = POS API live. Sheet và kho số chỉ là
dẫn xuất — chúng khớp nhau không chứng minh được gì.

**2. Cảnh báo kêu nhiều KHÔNG phải lý do nới ngưỡng.**
Ngày 04/08 detector B5 báo 7/15 mục có vấn đề; phiên làm đã kết luận "co ngót tự
nhiên" rồi hạ độ nhạy — tức bịt đúng cái lỗi mà detector sinh ra để bắt. Thực tế là
bug Smart Stop đang ăn mất đơn thật. Muốn nới ngưỡng thì phải chứng minh **từng**
cảnh báo là oan bằng ground truth, không phải bằng suy luận.

**3. Khi số liệu mâu thuẫn với lời giải thích của mình → lời giải thích sai.**
Dấu hiệu lẽ ra thấy ngay hôm đó: số dòng dao động **cả hai chiều**
(3.730 → 5.220 → 3.380). Co ngót tự nhiên chỉ đi xuống một chiều.

## Quy trình 6 bước

### 1. Khoanh lỗi
Lấy mã X từ `references/open-issues.md`. User mô tả triệu chứng chưa có mã → chẩn
đoán trước (bước 2–3), thấy là lỗi mới thì **thêm mã X mới vào sổ** rồi mới sửa.

### 2. Đo lại triệu chứng bằng số, đừng tin mô tả
Chạy đúng query/lệnh trong mục "Đo lại" của lỗi đó, trên đúng bản đang chẩn đoán. Số thay đổi
theo thời gian — lỗi có thể đã tự khỏi (do phiên khác sửa) hoặc nặng thêm. **Luôn ghi rõ mẫu số**
khi báo tỷ lệ: `is_confirmed` hay không, khung ngày nào. Hai phiên từng lệch nhau
20,7% vs 3,4% chỉ vì khác mẫu số.

### 3. Đối chiếu ground truth
Meta API cho spend, POS API cho đơn. Lệch >2% mới là lỗi thật; lệch từng ngày do
timezone TKQC là **cố hữu**, cả tháng mới khớp — đừng "sửa" cho khớp từng ngày.
`/api/talpha/sync-health` trả TKQC / shop đọc lỗi của vòng gần nhất.

### 4. Tìm nguyên nhân gốc, không chữa triệu chứng
Hỏi đủ 3 câu: dữ liệu sai từ nguồn, hay sai lúc ghi, hay sai lúc đọc? Sửa ở tầng
nào thì các tầng khác hết sai theo? Có bản code thứ hai đang chạy cùng logic không
(bản chép báo cáo `/root/talpha_reports/` trên VPS vs repo; luật thị trường có ba bản TS · Python · bot)?

### 5. Sửa + verify bằng chính phép đo ở bước 2
Trước/sau phải là **cùng một query**. Sửa sync thì phải chờ ít nhất 1 chu kỳ thật
rồi đo lại — compile được không có nghĩa là chạy đúng.

### 6. Ghi lại
Cập nhật `references/open-issues.md` (đóng lỗi hoặc sửa số đo) và memory. Lỗi đóng
rồi vẫn giữ trong sổ 1 mục ngắn "đã đóng ngày nào, verify bằng gì" — để phiên sau
không đào lại.

## Guard riêng cho nhóm lỗi này

- **Không xoá dữ liệu.** Nhánh Postgres: chỉ `SELECT`; sửa cách ghi thì sửa ở
  `sync/core/pg_writer.py` (raw chỉ thêm + dựng lại trong MỘT transaction) và view ở `db/views/`
  (dựng bằng `sync/core/pg_view.py`). Không DELETE/DROP/TRUNCATE bảng. Production BigQuery: chỉ
  `SELECT` và `CREATE OR REPLACE VIEW`; gói miễn phí — ghi bảng chỉ bằng LOAD JOB.
- **Một engine sync** (`sync/talpha/talpha_sync.py`, gộp 11/09/2026). Sửa `ops/talpha_reports/*` thì
  production còn phải `deploy_runtime.sh --yes` — bản chép trên VPS không tự cập nhật.
- **Backfill dữ liệu đã mất** (X2): phải hỏi user trước — kéo lại nhiều tháng từ
  Meta API có thể chạm rate limit. Nhánh Postgres: `python sync/talpha/talpha_sync.py --days N` /
  `--full` (ghi thêm vào raw, không xoá gì).
- Khoá POS / Meta: production ở `.env` runtime; nhánh Postgres mã hoá trong bảng `api_credentials`
  (không có sẵn trong shell). Đừng tự gọi POS từ CLI khi không có khoá — đi qua dashboard route.

## References

`references/open-issues.md` — sổ lỗi X: triệu chứng · bằng chứng · nguyên nhân
· cách đo lại · cách verify đã đóng. Đọc đúng mục được giao.
