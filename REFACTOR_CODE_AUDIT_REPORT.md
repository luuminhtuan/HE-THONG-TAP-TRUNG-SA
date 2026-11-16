# Báo cáo kiểm toán mã sau tái cấu trúc — TALPHA

| | |
|:--|:--|
| Ngày | 16/11/2026 |
| Nhánh kiểm | `refactor/english-standard` (worktree `.worktrees/refactor-english`), HEAD `0402d04` |
| Gốc so sánh | `e5def70` — đỉnh `kho-postgres` lúc tách nhánh (`kho-postgres` vẫn đứng ở đây, chưa có commit mới) |
| Quy mô | 27 commit · 426 file (135 thêm · 33 xoá · 190 sửa · 68 đổi tên) · +23.279 / −21.172 dòng |
| Trạng thái Git | Thư mục làm việc sạch — không có thay đổi chưa commit. Mọi thay đổi đều thuộc đợt refactor (23 commit 5 phase + 4 commit sửa lỗi có từ trước) |
| Cách kiểm | 6 mảng kiểm độc lập song song (DB · Python/ops · Dashboard TS · Nghiệp vụ · Bảo mật · Bot/CLI/Kiến trúc), mọi lỗi từ MEDIUM trở lên được kiểm lại lần hai ở phiên chính |

**Nguyên tắc đã giữ khi kiểm:** không sửa code; không ghi / migrate kho thật `talpha` (chỉ SELECT); mọi phép thử migration
chạy trên DB tạm (`audit_*`, đã xoá hết) hoặc bản sao `talpha_refactor_check`; không gọi dịch vụ ngoài từ công cụ kiểm (Meta,
POS, Pancake, 17TRACK, Google, Zalo được giả lập). Ngoại lệ duy nhất: khi mở trang Ads Command Center trên máy thử 3201,
chính dashboard tự gọi Meta bằng token sẵn có — chỉ đọc, giống hệt bản đang chạy.

**Không kết luận từ test PASS.** Ngoài bộ test, kết luận dựa trên: so sánh khác biệt base ↔ refactor trên CÙNG dữ liệu
(bản sao DB chụp cùng lúc, đầu vào giả lập giống nhau), dò phụ thuộc, đọc logic, chạy migration trên DB trống và DB nâng
cấp, và đi từng trang trên trình duyệt thật.

---

## 1. Tóm tắt điều hành

**Chất lượng chung.** Phần đổi tên và tách file được làm cẩn thận: mọi con số nghiệp vụ kiểm được đều **giống hệt bản gốc**
— 16 view (md5 toàn bộ dòng), 41 API GET, báo cáo tháng 9–11 (cả các lần ghi Google Sheet giả lập), 25 kịch bản bot,
engine đối soát quảng cáo, đường ghi đơn / chi tiêu, ma trận phân quyền 41 route × mọi vai. Lỗi tìm được tập trung ở **một
chỗ**: đổi giá trị trạng thái thị trường (`dang_ban/sap_chay/da_tat` → `active/upcoming/disabled`) sót một phép so sánh và
không phủ đường nạp file cũ; cùng với cơ chế nạp lúc khởi động mới (thay `execFileSync`) thiếu đường lùi khi DB chưa sẵn sàng.

| | Số lượng |
|:--|:--|
| Tổng lỗi / vấn đề | **26** |
| Theo mức | CRITICAL **1** · HIGH **1** · MEDIUM **8** · LOW **16** |
| Theo nguồn gốc | Do refactor **14** (1 CRITICAL, 1 HIGH, 3 MEDIUM, 9 LOW) · Có từ trước **12** (5 MEDIUM, 7 LOW) |
| Đã xác minh (tái hiện bằng chạy code / truy vết dòng code rõ ràng) | **23** |
| Chưa xác minh đủ | **3** (L-05, L-06 phần tác động ra ngoài repo, L-10) — và *mức độ lộ trên production* của H-01 |
| Lỗi đang gây sai số với dữ liệu hiện tại | **0** — C-01 và H-01 đều tiềm ẩn: bảng `market_overrides` hiện trống |

**Kết quả test:** pytest 198 ✓ · `npm test` 569 ✓ · `tsc` 0 lỗi · lint 0 lỗi (161 cảnh báo) · bot 175 ✓ · CLI 51/51 ✓ ·
`next build` ✓ · flake8 (bộ của CI) 0 · độ dài file đạt · **bandit thoát mã 1 ở cả base lẫn refactor** (job bảo mật CI đỏ
từ trước). Lệnh pytest nguyên văn **không chạy được trên Mac** (Python 3.9, không có pytest) — đã chạy tương đương trong
image `talpha-sync` (Python 3.12). Chi tiết ở mục 3.

**Mức sẵn sàng: NOT READY** — còn 1 CRITICAL + 1 HIGH do refactor (đều đã xác minh). Cả hai sửa nhỏ (vài dòng + phép thử).
Sửa xong nhóm 1 ở mục 6 và chạy lại kiểm tra thì dự kiến đạt **READY WITH WARNINGS**. Lưu ý độc lập với báo cáo này: máy
chủ VPS vẫn chạy BigQuery — nhánh này cần Postgres nên chưa thể đưa lên production dù sạch lỗi.

---

## 2. Danh sách lỗi

### 2.1 Bảng tổng

| ID | Mức | Nguồn gốc | Tóm tắt | File chính | Xác minh |
|:--|:--|:--|:--|:--|:--|
| C-01 | CRITICAL | Refactor | Nước "sắp chạy" chưa có số chia POS làm dựng view chết → `migrate` thoát 1, dashboard + scheduler không lên | `sync/core/pg_view.py:81` | ✅ (4 bên tái hiện độc lập) |
| H-01 | HIGH | Refactor | File thị trường cũ được nạp SAU migration 0009, giữ trạng thái tiếng Việt → nước đang bán ngừng kéo đơn | `sync/core/file_import.py:65-82` | ✅ cơ chế · ❓ mức lộ VPS |
| M-01 | MEDIUM | Refactor | DB chưa sẵn lúc khởi động → dashboard chạy luật gốc (thiếu thị trường nhập trên trang) tới khi khởi động lại | `src/lib/talpha/startup-data.ts:45-54` | ✅ |
| M-02 | MEDIUM | Refactor | DB treo lúc khởi động → dashboard không bao giờ nhận request, không sinh chìa nội bộ | `src/instrumentation.ts:14-20`, `src/lib/db.ts:29` | ✅ |
| M-03 | MEDIUM | Refactor | Đổi cột `schema_migrations` chạy ngoài transaction; 0008 không phòng thủ → hỏng giữa chừng là code cũ không migrate được | `sync/core/pg.py:56-60` | ✅ |
| M-04 | MEDIUM | Có từ trước | SQL người dùng đặt `set_config(...,false)` dính sang lượt truy vấn của người khác (pool chỉ đọc) | `src/lib/db.ts:104-120` | ✅ |
| M-05 | MEDIUM | Có từ trước | Lưu khoá khi `TALPHA_ENCRYPTION_KEY` sai làm hỏng cả kho khoá | `src/lib/talpha/credentials.ts:207-221` | ✅ |
| M-06 | MEDIUM | Có từ trước | Chế độ `DASHBOARD_PUBLIC` cho xem khoá bản rõ không cần đăng nhập; compose mặc định bật | `src/app/api/talpha/credentials/reveal/route.ts:22` | ✅ |
| M-07 | MEDIUM | Có từ trước | Tab Khách hàng / Market Intel ghép đơn chỉ theo `id` — 137 id trùng giữa các shop → khách / SĐT sai | `src/components/talpha/tabs/customer-tab.tsx:47-63` | ✅ |
| M-08 | MEDIUM | Có từ trước | Job bảo mật CI (bandit) luôn đỏ → cổng CI không bao giờ xanh | `.github/workflows/ci.yml:75` | ✅ |
| L-01 … L-16 | LOW | 7 refactor + 7 trước + 2 trộn | Xem 2.4 | | |

### 2.2 CRITICAL

#### C-01 — Nước "sắp chạy" chưa khai số chia POS làm sập bước dựng view và chặn cả hệ thống khởi động

- **Mức:** CRITICAL · **Nguồn gốc:** REFACTOR · **Xác minh:** VERIFIED — bốn mảng kiểm (DB, Python, TS, Nghiệp vụ) tái hiện độc lập; phiên chính đọc lại dòng code.
- **File / dòng:** `sync/core/pg_view.py:81` (hàm `money_divisor_sql`, dòng 76). Điểm kích hoạt: `dashboard-ui/src/components/tabs/markets-tab.tsx:44` (nước mới mặc định `status: "upcoming"`), `dashboard-ui/src/lib/talpha/market-config.ts:171-175` (chỉ bắt buộc số chia với `active`/`disabled`).
- **Mô tả:** `if div is None and v.get("status") == "sap_chay": continue` — vẫn so với giá trị cũ. Sau đợt đổi, trạng thái là `upcoming`, nên nước sắp chạy chưa có `pos_money_divisor` rơi xuống `raise SystemExit("❌ market … thiếu pos_money_divisor …")`.
- **Nguyên nhân:** commit `b403137` đổi giá trị trạng thái và sửa chính file này nhưng sót literal ở dòng 81. Phép thử hiện có (`tests/test_market_overrides.py:104`) chỉ thử nước sắp chạy CÓ số chia (=1) nên không bắt được.
- **Tái hiện:** DB tạm + một dòng `market_overrides` đúng như form `/admin` ghi: `{"status":"upcoming","shop_label":"TH","rate_vnd":null,"pos_money_divisor":null}` → `python -m sync.core.pg view --ep` thoát 1; `python -m sync.core.pg migrate` thoát 1. Cùng kịch bản trên code gốc với `"sap_chay"` → dựng view bình thường, thoát 0.
- **Ảnh hưởng:**
  1. Service `migrate` của compose thoát 1 → `dashboard` và `scheduler` (`depends_on … service_completed_successfully`, `docker-compose.yml:102,111`) **không khởi động** ở lần `compose up` / deploy sau. Trang `/admin` dùng để gỡ dòng hỏng cũng tắt theo.
  2. Vòng sync mỗi giờ bắt lỗi rồi ghi "Dựng lại view lỗi" — view **đóng băng**: mọi thay đổi tỷ giá, số chia, giá vốn, nước chuyển sang đang bán sau đó không vào số → số tài chính sai mà không ai báo.
  - Thao tác kích hoạt là thao tác bình thường: "Thêm nước" ở `/admin → Thị trường` với trạng thái mặc định. Hiện chưa xảy ra vì bảng `market_overrides` trống.
- **Khắc phục:** so với `"upcoming"` (an toàn hơn: `v.get("status") not in ("active", "disabled")`), thêm phép thử nước sắp chạy KHÔNG có số chia. Cân nhắc cho `migrate` không chặn cả stack chỉ vì dựng view lỗi (báo lỗi to nhưng vẫn để dashboard lên để sửa được).

### 2.3 HIGH

#### H-01 — File thị trường cũ được nạp SAU migration 0009, giữ nguyên trạng thái tiếng Việt

- **Mức:** HIGH (thành CRITICAL nếu file `data/thi_truong.json` trên VPS có mục thị trường) · **Nguồn gốc:** REFACTOR · **Xác minh:** VERIFIED cơ chế (ba mảng kiểm tái hiện); UNVERIFIED mức lộ thực tế — chưa xem được file trên VPS; file trên Mac này có `markets` rỗng và đã nạp.
- **File / dòng:** `sync/core/file_import.py:65-82` (`import_market_overrides` chép nguyên `settings`); thứ tự gọi ở `sync/core/pg.py:116-121` (`run_migrations` — gồm 0009 — chạy TRƯỚC `import_all`).
- **Mô tả:** Máy chuyển sang Postgres lần đầu (VPS sau này, hoặc volume DB mới) chạy 0009 trên bảng trống — không đổi gì — rồi mới chép file cũ có `status: "dang_ban"/"sap_chay"/"da_tat"` và `nguoi_cam`. 0009 không bao giờ chạy lại.
- **Nguyên nhân:** refactor đã lo tên tài liệu cũ (`LEGACY_DOC_NAMES`, `file_import.py:46`) nhưng không lo giá trị cấu hình cũ trong file thị trường; cả ba bộ đọc luật chỉ hiểu giá trị mới.
- **Tái hiện:** DB trống + `data/thi_truong.json` có Singapore `dang_ban`, UAE `da_tat`, Taiwan `nguoi_cam:"Quynh"` → `migrate` → `market_overrides` giữ nguyên giá trị cũ; `pos_shops_from_markets` cho SG `fetch_orders=False`; `ACTIVE_MARKETS` (Python) = `['Taiwan','Japan']`, `DISABLED_MARKETS` = `[]`.
- **Ảnh hưởng — ba nơi hiểu ba kiểu:**
  - Python sync: nước "đang bán" **ngừng kéo đơn POS** (chỉ ghi log mức info "sắp chạy — chưa kéo đơn") → thiếu đơn, thiếu doanh thu.
  - Dashboard `rules.ts:63-67`: nước đó rời khỏi danh sách đang bán; nước đã tắt rời khỏi danh sách đã tắt.
  - Bot `rules.js:41`: coi cả hai là đang bán.
  - Form `/admin` (`market-config.ts:100-110` `inputFromRules`): giá trị lạ hiện thành "Đang bán" → mở nước đã tắt rồi bấm lưu là **bật lại**.
  - Phần phủ `nguoi_cam` (ghi số nước cho người cầm) bị bỏ qua.
- **Khắc phục:** đổi giá trị ngay trong `import_market_overrides` theo đúng bảng của 0009 (hoặc chạy lại đoạn chuyển đổi của 0009 sau `import_all`); nên cho cả ba bộ đọc luật hiểu giá trị cũ như bí danh để chống tái phát. Thêm phép thử nạp file cũ trên DB trống.

### 2.4 MEDIUM

#### M-01 — DB chưa sẵn lúc khởi động: dashboard chạy luật gốc tới khi khởi động lại
- **Nguồn gốc:** REFACTOR · **Xác minh:** VERIFIED (tái hiện) + phiên chính đọc code.
- **File / dòng:** `dashboard-ui/src/instrumentation.ts:14-20`; `src/lib/talpha/startup-data.ts:45-54, 71-78`; `src/lib/talpha/rules.ts` (`STARTUP_OVERRIDES` tính một lần).
- **Mô tả / nguyên nhân:** `primeStartupData` đọc `market_overrides` một lần lúc boot; lỗi → `null`, không thử lại; `RULES` và mọi hằng sinh từ nó (tỷ giá, trạng thái, số chia, quyền theo team) cố định cả đời tiến trình. Bản gốc đọc lúc request đầu tiên nạp `rules.ts` — muộn hơn boot nên ít đua với Postgres hơn.
- **Tái hiện:** DB tạm có phủ `Taiwan {"rate_vnd":999}`; khởi động `next dev` của refactor khi cổng DB đóng, sau đó mở cổng → `GET /api/talpha/markets` trả Taiwan **800** (luật gốc), `market-config` báo `cho_khoi_dong_lai: true`. Code gốc cùng kịch bản → **999**.
- **Ảnh hưởng:** quy đổi VND và cấu hình nước sai trên mọi màn tới khi có người khởi động lại. Dễ gặp khi VPS khởi động lại và pm2 lên trước `postgresql.service`. Tín hiệu duy nhất là băng "cần khởi động lại" ở `/admin → Thị trường`.
- **Khắc phục:** phân biệt "đọc lỗi" với "chưa ai nhập"; lỗi thì thử lại nền, đọc được với vân tay khác thì `scheduleRestart()` (bot đã tự lành kiểu này); hoặc thử lại có giãn cách trong `register()` trong thời gian giới hạn.

#### M-02 — DB treo lúc khởi động: dashboard không bao giờ nhận request
- **Nguồn gốc:** REFACTOR · **Xác minh:** VERIFIED (tái hiện) + đọc code.
- **File / dòng:** `dashboard-ui/src/instrumentation.ts:14-17` (`await primeStartupData`) + `src/lib/db.ts:29` (`new Pool` không `connectionTimeoutMillis`, không `query_timeout`).
- **Tái hiện:** `DATABASE_URL` trỏ tới cổng TCP nhận kết nối nhưng không trả lời → `next dev` của refactor đứng ở "Starting…" hơn 90 giây, request hết giờ.
- **Ảnh hưởng:** dashboard tắt hẳn; `data/.internal_token` không được sinh (bot / việc nền không có chìa trên máy mới); handler `uncaughtException` chưa gắn. Bản gốc: `register()` không chạm DB, lượt đọc đồng bộ có hạn 15 giây.
- **Khắc phục:** `Promise.race` bước nạp với hạn ~10 giây; đặt `connectionTimeoutMillis` + `query_timeout` cho Pool; sinh chìa nội bộ và gắn handler TRƯỚC bước nạp.

#### M-03 — Đổi cột `schema_migrations` ngoài transaction; migration 0008 không phòng thủ
- **Nguồn gốc:** REFACTOR · **Xác minh:** VERIFIED (tái hiện).
- **File / dòng:** `sync/core/pg.py:56-60`; `db/migrations/0008_standardize_english_schema.sql:46` (`CREATE FUNCTION` không `OR REPLACE`), `:50-51` (`UPDATE app_documents SET name …` có thể đụng khoá chính).
- **Mô tả / nguyên nhân:** đổi `ten/chay_luc → name/applied_at` chạy autocommit trước transaction của từng file. Nếu 0008 hỏng, 0008 tự quay lui sạch nhưng cột đã đổi tên → code gốc (`SELECT ten FROM schema_migrations`) chết `UndefinedColumn`.
- **Tái hiện:** tạo trước hàm `date_in_tz` trên bản sao → `migrate` refactor lỗi `DuplicateFunction`, `tkqc` vẫn còn nhưng `schema_migrations` đã có cột `name` → `migrate` của code gốc lỗi `UndefinedColumn`. Gỡ xung đột rồi chạy lại refactor → đạt, schema giống hệt.
- **Ảnh hưởng:** đường quay về bản cũ khi triển khai hỏng cần sửa tay bằng `ALTER`. Các tình huống làm 0008 hỏng: hàm `date_in_tz` đã có; cùng lúc tồn tại `ads_recon_kho` và `ads_recon_rows`.
- **Khắc phục:** chỉ đổi cột trong cùng transaction với file chờ chạy đầu tiên (hoặc chỉ khi 0008 đang chờ); `CREATE OR REPLACE FUNCTION`; bỏ qua / gộp khi tên tài liệu đích đã có.

#### M-04 — `set_config` của người dùng dính sang truy vấn của người khác
- **Nguồn gốc:** CÓ TỪ TRƯỚC (`db.ts` và route chỉ khác tên) · **Xác minh:** VERIFIED trên 3201.
- **File / dòng:** `dashboard-ui/src/lib/db.ts:104-120` (`queryReadOnly` trả client về pool không `RESET ALL`); `src/app/api/query/route.ts:28-53` (`isQuerySafe`); `src/lib/talpha/ceo-ask-sql.ts:29-38` (`checkSql`).
- **Tái hiện:** `POST /api/query {"query":"SELECT set_config('auditsec.probe','persisted',false)"}` → 4 lượt sau đọc `current_setting('auditsec.probe',true)` đều ra `persisted` (cùng backend pid), mất sau ~10 giây kết nối rảnh.
- **Ảnh hưởng:** người xem mọi nước (hoặc câu SQL do AI viết ở "CEO hỏi") đặt `TimeZone` làm lệch `CURRENT_DATE` trong truy vấn tab của người khác → số sai; đặt `search_path` làm hỏng 4 tab dùng `/api/query`.
- **Khắc phục:** `RESET ALL` trong `finally` trước `release()` (tham số lúc nối như `-c TimeZone=UTC` vẫn giữ); chặn `set_config` ở `isQuerySafe` và `checkSql`.

#### M-05 — Lưu khoá khi `TALPHA_ENCRYPTION_KEY` sai làm hỏng cả kho khoá
- **Nguồn gốc:** CÓ TỪ TRƯỚC (cùng logic `luuKhoa` ở bản gốc) · **Xác minh:** VERIFIED trên DB tạm.
- **File / dòng:** `dashboard-ui/src/lib/talpha/credentials.ts:207-221` (`saveCredential`); `startup-data.ts:38`; `sync/core/credentials.py` (`read_credentials`).
- **Mô tả:** INSERT mã hoá bằng chìa sai vẫn thành công; bước làm mới cache sau đó lỗi → API trả 500 "Chưa lưu…" dù dòng đã ghi. Khi sửa lại chìa, một dòng mã hoá chìa khác làm cả câu `pgp_sym_decrypt` lỗi.
- **Tái hiện:** hai dòng mã hoá hai chìa khác nhau → `SELECT pgp_sym_decrypt(...,'đúng')` → `ERROR: Wrong key or corrupt data` cho cả câu.
- **Ảnh hưởng:** mọi khoá (Meta, POS, Pancake, 17TRACK, Gemini) lùi về `.env.local` (có thể là token cũ) ở cả dashboard và sync; giao diện báo sai trạng thái.
- **Khắc phục:** giải mã thử một dòng có sẵn / dòng canh gác bằng chìa hiện tại trước khi INSERT, cùng một transaction; giải mã từng dòng qua hàm trả NULL khi lỗi.

#### M-06 — Chế độ công khai cho xem khoá bản rõ không cần đăng nhập
- **Nguồn gốc:** CÓ TỪ TRƯỚC · **Xác minh:** VERIFIED bằng đọc code (3200/3201 hiện bật đăng nhập nên không bị).
- **File / dòng:** `dashboard-ui/src/app/api/talpha/credentials/reveal/route.ts:22` (chỉ chặn `a.kind === "internal"`); `docker-compose.yml:88` (`DASHBOARD_PUBLIC: ${DASHBOARD_PUBLIC:-true}`).
- **Ảnh hưởng:** máy chạy compose với mặc định, nếu bị mở ra ngoài (tunnel, bind sai), ai vào được cổng là đọc được token Meta / key POS bản rõ.
- **Khắc phục:** reveal từ chối cả `kind === "public"`; cân nhắc đổi mặc định compose thành `false`.

#### M-07 — Tab Khách hàng / Market Intel ghép đơn sai shop
- **Nguồn gốc:** CÓ TỪ TRƯỚC · **Xác minh:** VERIFIED — kho thật có **137** `id` đơn trùng giữa các shop; chạy đúng câu SQL của tab qua `/api/query` trên 3200 và 3201.
- **File / dòng:** `dashboard-ui/src/components/talpha/tabs/customer-tab.tsx:47-63` (`GROUP BY id`, `JOIN … ON o.id = v.order_id`); `market-intel-tab.tsx:46-50` (`PHONE_SRC`).
- **Ảnh hưởng:** số khách, phân nhóm khách quay lại, danh sách khách lớn lấy SĐT / tên của shop khác (ví dụ khách UAE 170 vs 172 giữa hai bản sao cùng dữ liệu), thay đổi giữa các lần chạy.
- **Khắc phục:** gom theo `(shop_id, id)` và ghép `o.shop_id = v.shop_id AND o.id = v.order_id`.

#### M-08 — Job bảo mật CI luôn đỏ
- **Nguồn gốc:** CÓ TỪ TRƯỚC (base còn quét thư mục `sql/` không tồn tại) · **Xác minh:** VERIFIED — chạy bandit cùng tham số CI trên cả hai cây.
- **File / dòng:** `.github/workflows/ci.yml:75` (bandit) + `ci-gate` dòng 169-180.
- **Mô tả:** bandit thoát mã 1: base 18 cảnh báo, refactor 19 (B310 ×3, B608 ×16). Cảnh báo mới duy nhất là `sync/core/pg.py:58` — f-string ghép hằng số trong khối DO đổi cột, dương tính giả.
- **Ảnh hưởng:** `ci-gate` không bao giờ xanh → cổng CI mất tác dụng chặn.
- **Khắc phục:** đánh dấu `# nosec B608` có lý do cho các câu ghép tên bảng/cột hằng, `nosec B310` cho URL cố định; hoặc nâng ngưỡng; sau đó để job chặn thật.

### 2.5 LOW

| ID | Nguồn gốc | File / dòng | Mô tả · nguyên nhân | Tái hiện | Ảnh hưởng | Khắc phục | Xác minh |
|:--|:--|:--|:--|:--|:--|:--|:--|
| L-01 | Refactor | migration 0008 (thiếu `RENAME` ràng buộc) | Chỉ mục / ràng buộc còn tên cũ: `tkqc_pkey` (trên `ad_accounts`), `bao_cao_tab_pkey`, `view_van_tay_pkey`, `view_van_tay_id_check`, `fb_ads_data_ngay`, `fb_ads_data_raw_khoa`, `fb_adset_data_*` | `\d ad_accounts` trên DB đã migrate | Chỉ là tên; DB mới và DB nâng cấp giống nhau | Migration mới `ALTER INDEX … RENAME` / `RENAME CONSTRAINT` | ✅ |
| L-02 | Refactor (cố ý, có ghi) | `sync/core/pg.py:75-85` | Vai cũ `talpha_doc`, `talpha_doc_nuoc` vẫn `LOGIN`, giữ mật khẩu cũ, vẫn đọc bảng thô; đổi `TALPHA_READONLY_PASSWORD` không đổi chúng (bảng riêng đã bị thu quyền) | `rolcanlogin = t` trên `talpha_refactor_check` | Thêm một cửa đăng nhập chỉ đọc không được xoay mật khẩu | `ALTER ROLE … NOLOGIN` / bỏ vai ở migration dọn dẹp | ✅ |
| L-03 | Refactor | `lib/talpha/startup-data.ts:24-30,77`, `credentials.ts:72-79` | Khoá đã giải mã lúc boot nằm trên `globalThis` suốt đời tiến trình, không bao giờ xoá / cập nhật; instance module mới (HMR `next dev`) dùng bản boot cho 1–2 lượt đầu | Truy vết code | Khoá đã xoay / xoá còn trong bộ nhớ; tạm thời dùng khoá cũ hoặc `.env` | Xoá snapshot sau khi nhận; để cache sống trên `globalThis` | ✅ (truy vết) |
| L-04 | Refactor | `ads-reconciliation-cli/src/engine.mjs:30-35`; `ops/deploy/vps-setup.sh:68` | CLI cần Node ≥ 22.18 (nạp `.ts`) nhưng không kiểm; `vps-setup.sh` chỉ kiểm phiên bản lớn | `node --no-experimental-strip-types bin/reconcile.mjs --help` → `ERR_UNKNOWN_FILE_EXTENSION` | VPS có Node 22.0–22.17: CLI và `tests/ads-recon.test.cjs` hỏng (dashboard không ảnh hưởng) | Kiểm `process.versions.node` trước `import()` động; kiểm cả phiên bản nhỏ | ✅ |
| L-05 | Refactor | `ads-reconciliation-cli/src/run.mjs:14-19,41-47` | Thư mục lịch sử `data/ky` → `data/periods` (và `nguon` → `sources`) không đọc thư mục cũ | Không có dữ liệu để thử (thư mục cũ trống) | So sánh tuần–tuần âm thầm bắt đầu lại nếu ai đó có lịch sử cũ | Đọc thư mục cũ làm dự phòng | ❓ |
| L-06 | Refactor (cố ý) | `/api/talpha/ad-accounts`, `market-config?overrides=1`, `income-statement` (`cfg`), `/api/talpha/me` | Hợp đồng API đổi: khoá JSON tiếng Anh; 5 route cũ (`lai-lo`, `khoa`, `thi-truong`, `tkqc`, `pancake-nuoc`) trả 404, không có bí danh | So JSON 3200 ↔ 3201 | Mọi bên gọi trong repo đã cập nhật (đã kiểm); client ngoài repo / dấu trang API sẽ hỏng. Bot mới + dashboard cũ tự lành nhờ vòng vân tay | Tuỳ chọn: bí danh chuyển hướng một phiên bản | ✅ trong repo · ❓ ngoài repo |
| L-07 | Refactor (cố hữu) | — | Code cũ và mới không dùng chung một DB: code gốc `migrate` trên DB đã nâng cấp thoát 1. Container `talpha-lich-1` mồ côi (đang chạy trên Mac này, đúng với bản gốc) nếu quên `--remove-orphans` sẽ ghi lỗi mỗi giờ | Chạy `migrate` gốc trên bản sao đã nâng cấp | Bot báo động giả, `sync_health` đỏ; không có đường quay lui sau 0008 | Đã ghi `--remove-orphans` trong CLAUDE.md / README / POSTGRES.md; thêm bước kiểm trong kịch bản chuyển | ✅ |
| L-08 | Refactor | nhiều chỗ | Chú thích / log / nhãn còn tên cũ: `docKhoa` (`credentials.ts:17`, `ceo-ask/route.ts:236`, `market-config/route.ts:147`, `realtime/_lib/config.ts:17`, `sync/core/credentials.py:11`), `queryChiDoc` (`query/route.ts:26`, `ceo-ask/route.ts:90`, `ceo-ask-sql.ts:28`), `ghiCodDuoc` (`access-rules.ts:183`, `cod-actions/route.ts:24`); log `lai-lo` (`income-statement/route.ts:101,165`), `[thi-truong]` (`market-config/route.ts:193`); `tkqc_loai`/`vao_bao_cao` trong `db/views/00_fb_*.sql:5`, `ad-accounts/route.ts:4`, `ad-accounts-tab.tsx:9`; `sap_chay` trong chú thích `business_rules.py:22`; nhãn test `van_don:` (`shipment_alerts.test.js`); `lib/db.ts:83`, `access-rules.ts:251,280` nói vai mới từ migration 0003 | grep | Người bảo trì đi tìm hàm không tồn tại; grep log theo tên mới bỏ sót | Sửa chú thích / tiền tố log | ✅ |
| L-09 | Refactor | `.pre-commit-config.yaml` | Hook độ dài file (`types_or: [python, ts, tsx]`) bỏ `.js` trong khi CI chặn cả `.js` | Đọc cấu hình | Lỗi chỉ lộ khi lên CI | Thêm `javascript` | ✅ |
| L-10 | Có từ trước | `src/app/login/page.tsx:27,50` | `callbackUrl` đưa thẳng vào `router.push` → `/login?callbackUrl=https://…` chuyển ra trang ngoài sau đăng nhập | Truy vết code (chưa thử trình duyệt) | Lừa đảo dẫn người dùng | Chỉ nhận đường dẫn bắt đầu `/`, không `//` | ❓ |
| L-11 | Có từ trước | `src/proxy.ts:56` + `/api/auth/validate` | Route kiểm mật khẩu nằm dưới `/api/auth/*` (mở), không giới hạn tần suất; 401/403 khác nhau lộ tên đăng nhập có tồn tại | Truy vết code | Dò mật khẩu / dò tên | Giới hạn tần suất, trả lỗi chung | ✅ |
| L-12 | Có từ trước | `sync/talpha/talpha_sync.py` (`main`) | Luôn thoát 0 dù đơn / chi tiêu / dựng view lỗi → lịch ghi lượt `sync` là đạt | Đọc code | Đèn "Cập nhật lúc…" xanh khi sync hỏng (`sync_health` vẫn đúng) | Trả mã lỗi khi có bước hỏng | ✅ |
| L-13 | Có từ trước | xem 4.2 | Còn hàm lớn (`MarketCodRecon` 447 dòng, `TwCodRecon` 432, `TALPHATrackingTab` 432…); logic route dời vào `app/api/**/_lib` (order-ledger 945 dòng) nằm ngoài bộ `npm test`; `parseCampaign` ở `realtime/_lib/campaign-keys.ts` khác `rules.ts` (thiếu dự phòng `primary_market`) | Đếm dòng / so hàm | Khó bảo trì; logic trùng lệch nhau | Dời logic thuần vào `lib/talpha` có test; gộp `parseCampaign` | ✅ |
| L-14 | Có từ trước | `config/talpha_rules.json → ads_settlement.ad_accounts._mo_ta` | Chú thích nói `roster_file` "không còn ai đọc" nhưng CLI đọc `ops/talpha_reports/ad_accounts.json`; thiếu file → 2 test e2e hỏng, kiểm TKQC lạ tắt âm thầm | Xoá file trong bản chép tạm → 49/51 | Người dọn dẹp xoá nhầm (đã từng xảy ra trong đợt này, đã khôi phục) | Sửa chú thích | ✅ |
| L-15 | Có từ trước | `/api/talpha/pnl-costs`, `/api/talpha/cod-recon` | Câu SQL không `ORDER BY` → thứ tự dòng phụ thuộc vị trí vật lý | So 3200 ↔ 3201 | Danh sách nhảy thứ tự giữa các lần / máy | Thêm `ORDER BY` | ✅ |
| L-16 | Có từ trước | `sync/core/pg_view.py:15` | Tài liệu nhắc `pg view --in` nhưng không có | Đọc code | Lệnh trong tài liệu không chạy | Sửa tài liệu hoặc thêm lệnh | ✅ |

### 2.6 Bốn bản sửa lỗi có chủ đích (4 commit cuối) — đánh giá: đúng

| Commit | Nội dung | Đánh giá |
|:--|:--|:--|
| `db7be56` | `format_all`: tháng chưa có bộ file Sheet vẫn ghi Postgres | Đúng — `WRITE_SHEET=bool(KEY and FILE_SET)`, các bước Sheet nhận `{}` |
| `fcbd236` | Roster đối soát QC: TK có chi tiêu trong kỳ sao kê = đang chạy | Đúng — khoảng ngày là toàn bộ dòng sao kê đã lưu, khớp việc đối soát trên toàn kho; không truyền roster thì kết quả engine như cũ |
| `76fa146` | Ngân sách campaign chia theo offset tiền của TKQC | Đúng — không chỗ nào khác đọc cột ngân sách nên không có chỗ nào đang "bù" cho phép chia 100 cũ; bảng thay toàn bộ mỗi vòng |
| `0402d04` | Deploy: dò remote máy chủ kéo, dừng nếu `main` chưa đẩy | Đúng — hỏng thì dừng (an toàn) |

---

## 3. Kết quả kiểm thử (lệnh và kết quả thật)

| # | Lệnh | Kết quả |
|:--|:--|:--|
| 1a | `DATABASE_URL=… TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/` (nguyên văn, trên Mac) | **Không chạy được** — `python3` = 3.9.6, `No module named pytest` (rc 1). Mã nguồn dùng cú pháp ≥ 3.10 |
| 1b | Cùng bộ test trong image `talpha-sync` (Python 3.12.16), `DATABASE_URL` = kho thật (phép thử tự dựng schema tạm rồi xoá), `-v` | **198 passed**, 0 skipped, rc 0 |
| 2 | `cd dashboard-ui && npm test` (Node 25.9.0) | **569 ✓**, 0 ✗, rc 0 |
| 3 | `npx tsc --noEmit` | rc 0, **0 lỗi** |
| 4 | `npm run lint` | rc 0 — **0 lỗi**, 161 cảnh báo |
| 5 | `next build` (từ HEAD `0402d04`) | **Đạt** (compiled successfully; 11 trang tĩnh) |
| 6 | `ops/zalo-alerts: npm test` | rc 0 — 8 bộ: 38 + 14 + 39 + 27 + 34 + 12 + 8 + 3 = **175 ✓** |
| 7 | `ads-reconciliation-cli: npm test` | **51/51**, rc 0 |
| 8 | flake8 đúng bộ chọn của CI (`E9,F63,F7,F82,F401`) | **0** |
| 9 | Kiểm độ dài file đúng phạm vi CI (py ≤ 300, ts/tsx ≤ 500, bot js ≤ 500) | **Đạt** cả 3 (chỉ 2 file test `.cjs` > 500 dòng, ngoài phạm vi CI) |
| 10 | bandit đúng tham số CI | **rc 1** — base 18 / refactor 19 cảnh báo (M-08) |
| 11 | Quét khoá ghi cứng của CI (`git grep`) | Không thấy — đạt |
| 12 | Migration trên DB trống (0001→0009 + view) và DB nâng cấp (bản sao kho thật) | Đạt; schema hai đường giống nhau (trừ 3 quyền vai cũ — L-02); chạy lại = không đổi; 0008 hỏng thì quay lui sạch (trừ M-03) |
| 13 | Import mọi module đã đổi tên / tách | 42 module Python sync/report/scheduler import được; bố cục phẳng của `deploy_runtime.sh` đủ file; mọi `require` của bot giải được, không vòng |
| 14 | Trình duyệt thật (Chrome, tài khoản admin) trên 3201 | 21 trang (16 tab + 4 mục quản trị + Ads Command Center) hiển thị; **0 lỗi console / hydration**; **107/107** request `/api/` trả 200 |
| 15 | So khác biệt base ↔ refactor trên cùng dữ liệu | 16 view md5 giống hệt; 41 API GET giống (trừ thay đổi cố ý, dữ liệu trôi theo giờ, thứ tự dòng không `ORDER BY`, nhiễu số thực < 1e-9); `format_all` tháng 9/10/11 giống (bảng, log, 25 lần ghi Sheet giả lập); sync giả lập POS/Meta giống mọi bảng (trừ ngân sách ÷1 cố ý); 300 đơn ngẫu nhiên qua `_normalize_order` giống; 25 kịch bản bot dry-run giống từng byte; engine đối soát QC giống từng byte |

---

## 4. Đánh giá kiến trúc

### 4.1 Theo module

| Module | Đánh giá |
|:--|:--|
| **Python Sync** | Tách `talpha_sync.py` thành `sync_runtime` / `order_sync` / `ads_sync` / `campaign_sync` / `partner_orders_sync` gọn, có lý: trạng thái dùng chung (`_pg_conn`, `_ad_accounts_cache`) chỉ ở `sync_runtime` và đi qua hàm — không dính bẫy import theo giá trị. `pg_writer` đổi tên thuần: raw chỉ thêm, bảng sạch dựng lại trong MỘT transaction, không xoá-trước-khi-kéo. Hàm lớn nhất 116 dòng. Lỗi: C-01 (`pg_view`), H-01 (`file_import`), M-03 (`pg.py`), L-12. |
| **Reports** | `format_all.py` thành điểm chạy `main()` + 6 module (`report_data`, `report_tables`, `report_store`, `sheet_writer`, `campaign_pages`, `order_rules`); `talpha_rules.py` nạp lười bằng `__getattr__`. Thứ tự đọc/ghi và mọi dòng log mà `daily_guarded.sh` / `report_health` đọc giữ nguyên. Kết quả 3 tháng giống hệt bản gốc. |
| **Dashboard UI** | Tab lớn tách thành thư mục cùng tên; số lượng hook / prop / handler và mảng phụ thuộc tương đương bản gốc; slug URL và khoá `localStorage`/`sessionStorage` không đổi; 21 trang chạy sạch trên trình duyệt. Chưa phải tái kiến trúc: còn component 400+ dòng (L-13). `any` 145 → 141; `as unknown as` 34 → 36 (accessor cấu hình có kiểu, không che lỗi thật). |
| **API** | 41 route = 41 route; 5 nhóm đổi tên; phương thức HTTP giữ nguyên; `API_RULES` phủ mọi route, không luật chết; ma trận quyền (25 tổ hợp vai × team và 4 vai × 4 tham số `market`) giống hệt. Logic route lớn dời nguyên văn vào `app/api/**/_lib` — dễ đọc hơn nhưng vẫn nằm ngoài `lib/talpha` và ngoài bộ test (L-13). |
| **Database** | 0001–0007 giống từng byte; 0008/0009 chỉ `RENAME` + chuyển giá trị, chạy lại an toàn; vai chỉ đọc mới đúng phạm vi (không đọc 6 bảng riêng, không ghi, không `SET ROLE` thoát được). Thiếu đổi tên ràng buộc / chỉ mục (L-01), vai cũ còn đăng nhập (L-02), độ bền khi hỏng giữa chừng (M-03). |
| **Zalo Bot** | Tách `bot.js` → `bot_main` + `bot_*`, `shipment_*`, `daily_report_*` mạch lạc: không vòng `require`, mỗi trạng thái (phiên, hàng gửi, chống trùng lệnh, cache) chỉ ở một module; file trạng thái / phiên không đổi tên. Khởi động bất đồng bộ có đường lùi: dashboard tắt → chạy luật gốc, tự khởi động lại khi vân tay đổi. Chưa kiểm được chế độ dịch vụ thật (đăng nhập Zalo). |
| **Ads Reconciliation CLI** | Engine chuyển `.mjs` → TypeScript có kiểu, kết quả giống từng byte; cờ tiếng Việt cũ vẫn nhận. Phụ thuộc Node ≥ 22.18 chưa được kiểm (L-04), thư mục lịch sử cũ (L-05). |
| **Khởi động / hiệu năng** | Bỏ `execFileSync` **thật sự** giải phóng event loop: không còn `execFileSync/execSync/spawnSync` trên đường request (chỉ còn `git rev-parse` lúc build). Đổi lại, sự phụ thuộc vào DB dời sang lúc khởi động mà thiếu hạn giờ và thử lại → M-01, M-02, L-03. |

### 4.2 Clean Architecture / SOLID / DRY — nhận xét thẳng

- Đợt này chủ yếu là **chuẩn hoá tên + tách file theo trách nhiệm hiển thị**. Đạt mục tiêu độ dài file (base có 25 file vượt ngưỡng trong phạm vi CI — 16 ts/tsx, 6 py, 3 bot js → nay 0) và dễ tìm code hơn hẳn; **chưa** đổi ranh giới tầng: logic nghiệp vụ của các route lớn vẫn ở tầng API (`_lib`), một số component vẫn ôm cả lấy dữ liệu lẫn hiển thị.
- Không thấy file "chỉ để re-export" vô nghĩa hay chia vụn máy móc; vài chỗ tách theo cụm hàm là hợp lý.
- DRY: không tạo trùng lặp mới; trùng lặp cũ còn (`parseCampaign` ×2; luật phủ thị trường ×3 — cố ý vì ba runtime, có chung fixture kiểm chéo, và đã được xác nhận cho kết quả giống từng byte).
- Xử lý lỗi: số `except` rộng ở Python (36 có xử lý + 1 im lặng) và `catch` rỗng ở JS (12 → 13) gần như không đổi so với bản gốc.

---

## 5. Mức sẵn sàng production

**Kết luận: NOT READY.**

- Còn **1 CRITICAL (C-01) + 1 HIGH (H-01)** do refactor gây ra, đã xác minh. Cả hai tiềm ẩn (không sai số với dữ liệu hôm nay) nhưng C-01 bị kích hoạt bởi một thao tác bình thường ở `/admin`, còn H-01 nằm đúng trên đường máy chủ thật sẽ đi khi chuyển sang Postgres.
- Toàn vẹn nghiệp vụ ở trạng thái hiện tại: **giữ nguyên** — mọi phép so khác biệt trên cùng dữ liệu đều khớp.
- Điều kiện để lên **READY WITH WARNINGS:** sửa nhóm 1 (C-01, H-01, M-03) kèm phép thử, chạy lại toàn bộ mục 3. Nên sửa thêm nhóm 2 (M-01, M-02) trước khi đặt lên máy chủ có khả năng khởi động lại cùng Postgres.
- Độc lập với báo cáo: VPS hiện chạy BigQuery; nhánh này cần Postgres + `DATABASE_URL` trên máy chủ trước (CLAUDE.md).

---

## 6. Thứ tự ưu tiên xử lý (đề xuất — chờ duyệt, CHƯA sửa)

| Nhóm | Lỗi | Lý do | Ước lượng |
|:--|:--|:--|:--|
| **1 — chặn merge** | C-01, H-01, M-03 | Lỗi do refactor; làm sập hệ thống / ngừng kéo đơn / kẹt khi quay lui | Nhỏ: vài dòng mỗi lỗi + 3 phép thử |
| **2 — độ bền khởi động** | M-01, M-02, L-03 | Hệ quả của việc bỏ `execFileSync`; dễ gặp khi máy chủ khởi động lại | Vừa: thêm hạn giờ, thử lại, tự khởi động lại |
| **3 — bảo mật / số liệu có từ trước** | M-04, M-05, M-06, M-07, M-08 | Không do refactor nhưng có ảnh hưởng thật (số khách sai, khoá hỏng, CI đỏ) | Nhỏ–vừa, mỗi lỗi độc lập |
| **4 — dọn dẹp** | L-01, L-02, L-04 … L-16 | Tên, chú thích, tài liệu, độ bền phụ | Nhỏ, gộp được 1–2 commit |

---

## Phụ lục A — Đã kiểm và sạch (tóm tắt)

- **Đổi tên & phụ thuộc:** không còn import tới file không tồn tại (TS: `tsc`; Python: import 42 module + kiểm `module.attr` 65 file + 57 lời gọi theo tên tham số; bot: mọi `require`); mọi URL `fetch` của frontend / bot / script trỏ tới route có thật đúng phương thức; mọi câu SQL tĩnh (101 câu) `EXPLAIN` được trên schema mới, công cụ này bắt đủ 23 câu tên cũ khi chạy trên code gốc; 40 câu SQL động kiểm tay.
- **Khoá cấu hình:** mọi khoá / giá trị đổi trong `talpha_rules.json` (`owner`, `inactive_from`, `ad_account_categories{…}`, `income_statement_rules{…}`, `active/upcoming/disabled`, `seed/other`, tab `income-statement`, `meta_currency_offset`) đã được dò ở Python, TS, bot, SQL view, `.gs`, `.sh` — chỗ đọc giá trị cũ duy nhất là C-01. Migration 0009 chuyển đúng, giá trị lạ để nguyên, chạy lại không đổi.
- **Công thức:** số chia POS (TW/JP 1, SG/AE 100), quy đổi VND, giá vốn, phí 3PL (cả phí ship Nhật), tách campaign test, gán marketer / nước, lãi lỗ, đối soát COD, sổ đơn, đối soát QC, loại TKQC — giống bản gốc trên cùng đầu vào (cả có và không có phần phủ thị trường).
- **Bảo mật:** không có `dangerouslySetInnerHTML`; nội suy SQL chỉ dùng hằng / mã nước đã thoát / tham số; không lộ bí mật trong 907 file của `.next`; chìa nội bộ so sánh an toàn thời gian, quyền file 0600; giới hạn tải lên không đổi ở 4 route.
- **Ghi dữ liệu:** raw chỉ thêm, dựng lại bảng sạch trong một transaction, đánh dấu đơn bị xoá trên POS — giống hệt; tên việc nền (`sync`, `bao_cao`, `ton_kho`…) khớp đèn trạng thái.

## Phụ lục B — Chưa kiểm được

- File `data/thi_truong.json` và phiên bản Node trên VPS (không SSH) — quyết định mức độ H-01 và L-04.
- Chế độ dịch vụ thật của bot (đăng nhập Zalo, listener) — chỉ kiểm được dry-run.
- Route gọi dịch vụ ngoài khi chạy thật (realtime, pancake-messages, tồn kho sống, kiểm khoá Gemini) — đã chạy với dịch vụ ngoài giả lập.
- Các route POST/PUT/DELETE chưa chạy thật (đổi trạng thái) — kiểm tĩnh hợp đồng body và phân quyền.
- Phiên người dùng bị giới hạn nước trên trình duyệt (kho thử chỉ có 2 tài khoản giám đốc) — thay bằng ma trận quyền biên dịch từ `access-rules`.
- Next production chạy nhiều instance.

## Phụ lục C — Môi trường và dấu vết

- Bản sao kiểm `talpha_refactor_check` (đã migrate) và máy thử `http://127.0.0.1:3201` vẫn chạy để đối chiếu; mọi DB tạm `audit_*` đã xoá; không file nào trong repo bị sửa ngoài báo cáo này.
- Script, kết quả so khác biệt, log: `/private/tmp/claude-501/-Volumes-SSD-PROJECTS-HE-THONG-TAP-TRUNG-SA/82debf34-a016-42a0-917f-710756d05e4f/scratchpad/audit/` (thư mục tạm của phiên — có thể mất khi khởi động lại máy).

---

## 7. Kết quả sửa (16/11/2026, sau khi duyệt)

Đổi hướng theo yêu cầu: nhánh `kho-postgres` chưa từng lên production nên **bỏ hẳn phần chuyển đổi DB** — 9 migration
gộp thành `db/migrations/0001_initial_schema.sql` dựng thẳng tên tiếng Anh (không `RENAME`, không vai cũ, không bí
danh `ngay_theo_mui`). Kiểm chứng: DB trống dựng bằng bộ 9 file cũ và bằng file mới cho cấu trúc giống hệt (so
`pg_dump --schema-only`), chỉ khác đúng chỗ cố ý: tên chỉ mục / ràng buộc tiếng Anh, không còn quyền vai cũ, không
còn hàm bí danh.

| Commit | Nội dung |
|:--|:--|
| `808dd4f` | Gộp migration thành `0001_initial_schema.sql`; bỏ đổi cột `schema_migrations`, bỏ thu quyền vai cũ |
| `d96b70e` | C-01, H-01 |
| `6ab5bc6` | M-01, M-02, L-03 |
| `0398c39` | M-04, M-05, M-06, M-07, M-08 |
| `95b6283` | L-04, L-05, L-08, L-09, L-10, L-11, L-12, L-14, L-15, L-16 + lệnh tạo tài khoản đầu tiên |
| `3f43ad0` | Tài liệu (CLAUDE.md, POSTGRES.md, DASHBOARD_MAP.md, README, .agent/rules) |

| ID | Kết quả | Kiểm bằng |
|:--|:--|:--|
| C-01 | ✅ Sửa — nước `upcoming` thiếu số chia được bỏ qua khi dựng view | Phép thử mới hỏng khi gỡ bản sửa, đạt khi có |
| H-01 | ✅ Sửa — `file_import` đổi trạng thái / `nguoi_cam` của file cũ lúc chép | Phép thử nạp file cũ trên schema tạm |
| M-01 | ✅ Sửa — kho lỗi lúc khởi động thì thử lại nền 30 giây/lần, khác thì tự khởi động lại | Chạy thật: kho tắt → Taiwan 800 (luật gốc) → mở kho → log "khởi động lại để nạp" + tiến trình thoát 0 |
| M-02 | ✅ Sửa — nạp kho có hạn 15 giây; chìa nội bộ + bắt lỗi làm trước; pool có `connectionTimeoutMillis` | Chạy thật: kho treo → dashboard mở cửa sau 18 giây, có `.internal_token` |
| M-03 | ✅ Hết đối tượng — bước đổi cột / đổi tên DB cũ đã bỏ cùng migration chuyển đổi | — |
| M-04 | ✅ Sửa — `RESET ALL` trước khi trả kết nối chỉ đọc; chặn `set_config` ở `/api/query` và CEO hỏi | Đọc code + build |
| M-05 | ✅ Sửa — `safe_decrypt` giải mã từng dòng; không cho lưu khi chìa không mở được khoá nào | Phép thử Python: chìa sai → không ghi; một dòng chìa khác không che khoá còn lại |
| M-06 | ✅ Sửa — `/credentials/reveal` từ chối chế độ công khai | Đọc code |
| M-07 | ✅ Sửa — ghép `(shop_id, id)`, đếm `order_uid` | Chạy câu mới qua `/api/query`: khớp đối chứng ghép thẳng theo shop |
| M-08 | ✅ Sửa — bandit thoát 0 (`# nosec` kèm lý do ở 18 chỗ đã soát; thêm `_safe_ident` ở `_rebuild_from_raw`) | bandit đúng tham số CI; kiểm AST không chuỗi SQL nào bị chèn `nosec` |
| L-01 | ✅ Hết — chỉ mục / ràng buộc đặt tên tiếng Anh từ đầu | Danh sách `pg_indexes` của DB mới |
| L-02 | ✅ Sửa — schema mới không tạo vai cũ; máy local đã `DROP ROLE talpha_doc, talpha_doc_nuoc` | `pg_roles` |
| L-03 | ✅ Sửa — bộ đệm khoá trên `globalThis`; bản rõ lúc khởi động giao một lần rồi xoá | Phép thử `tests/startup-data.test.cjs` |
| L-04 | ✅ Sửa — CLI kiểm Node ≥ 22.18 trước khi nạp engine; `vps-setup.sh` kiểm cả phiên bản nhỏ | `bash -n`, CLI 52/52 |
| L-05 | ✅ Sửa — CLI đọc thêm lịch sử ở `data/ky` cũ (thư mục mới thắng khi trùng kỳ) | Phép thử CLI mới |
| L-06 | ⏭ Không làm — bí danh route cũ đi ngược chủ trương bỏ hẳn bản trung gian; mọi bên gọi trong repo đã đổi | — |
| L-07 | ✅ Tài liệu — `docs/POSTGRES.md` → "Chuyển từ kho-postgres" (sao lưu, dựng lại DB, nhập khoá, tạo tài khoản) | — |
| L-08 | ✅ Sửa — chú thích / tiền tố log / nhãn test còn tên cũ | grep |
| L-09 | ✅ Sửa — hook pre-commit kiểm cả `.js` | — |
| L-10 | ✅ Sửa — `callbackUrl` chỉ nhận đường dẫn cùng nguồn | Đọc code + build |
| L-11 | ✅ Sửa — kiểm mật khẩu trước mọi thông báo riêng, băm giả cho tên không tồn tại, 10 lần sai / 15 phút / tên | Đọc code + build |
| L-12 | ✅ Sửa — `talpha_sync` thoát 1 khi cả một bước hỏng (TKQC / shop lẻ không tính) | Đọc code; lịch vẫn chạy báo cáo bất kể mã |
| L-13 | ⏭ Không làm trong đợt này — dời `_lib` của route vào `lib/talpha` kèm test và gộp `parseCampaign` của realtime là tái cấu trúc lớn; gộp `parseCampaign` còn đổi số realtime (thêm dự phòng `primary_market`) — cần quyết định nghiệp vụ riêng | — |
| L-14 | ✅ Sửa — chú thích `roster_file` | — |
| L-15 | ✅ Sửa — `ORDER BY` cho `order-costs` (pnl-costs) và đơn đã giao của `cod-recon` | tsc |
| L-16 | ✅ Sửa — tài liệu `pg view --ep` | — |

Kiểm lại sau sửa: pytest **201** ✓ · `npm test` **574** ✓ · tsc 0 · lint 0 lỗi · bot 175 ✓ · CLI 52/52 · flake8 0 ·
bandit **thoát 0** · độ dài file đạt.

**Mức sẵn sàng sau sửa: READY WITH WARNINGS** — không còn lỗi CRITICAL / HIGH đã xác minh, mọi kiểm thử bắt buộc đạt;
còn L-06 và L-13 (LOW, có lý do ở bảng trên). Máy chủ VPS vẫn chạy BigQuery — đưa nhánh này lên production cần dựng
Postgres trên máy chủ trước.

**Máy local đã chuyển sang nhánh này (16/11/2026):** sao lưu DB cũ (`data/backups/talpha-kho-postgres-20261116-1613.dump`,
ngoài git), dựng lại DB `talpha` bằng `0001_initial_schema.sql`, bỏ vai `talpha_doc*`, chép nguyên 9 khoá đã mã hoá và 2
tài khoản giám đốc từ bản sao lưu, kéo lại đơn (toàn bộ lịch sử) + chi tiêu 63 ngày, dựng lại báo cáo tháng 9–11. Đối
chiếu với bản sao lưu: chi tiêu tháng 9, 10 khớp tuyệt đối; không mất đơn nào (bản mới đủ thêm đơn trước 05/10 mà bản cũ
chưa kéo). Stack chạy từ worktree: `docker compose --env-file ../../.env up -d --remove-orphans`.
