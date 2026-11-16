---
paths:
  - "sync/**/*.py"
  - "ops/**/*.py"
  - "scripts/**/*.py"
  - "tests/**/*.py"
---
# Quy ước Python — TALPHA

## Chạy ở đâu

- Engine sync DUY NHẤT: `sync/talpha/talpha_sync.py` + `sync/core/`. Đừng chép bản thứ hai đi đâu.
- Báo cáo tháng: `ops/talpha_reports/format_all.py` (ghi bảng `bao_cao_tab`, có khoá Google thì ghi
  thêm Google Sheet). Máy chủ chạy bản chép ở `/root/talpha_reports/` — sửa ở repo rồi
  `deploy_runtime.sh --yes`, không sửa tay bản chép.
- Code nhánh này dùng cú pháp Python 3.10+ (`int | None`). Docker chạy Python 3.12 (image
  `talpha-sync`), CI 3.11. Python hệ thống của máy Mac (3.9) không chạy được.

## Luật nghiệp vụ

- Tỷ giá, số chia tiền POS, tên marketer, phí 3PL, giá vốn, ngưỡng: đọc từ `config/talpha_rules.json`
  qua `ops/talpha_reports/talpha_rules.py` / `sync/core/business_rules.py`. KHÔNG gõ vào code.
- Phần nước thêm / sửa trên `/admin` (bảng `market_overrides`) phủ lên file gốc qua
  `sync/core/thi_truong.py`. Luật phủ chạy chung fixture `tests/fixtures/thi_truong_phu.json` với
  bản TS (`lib/talpha/market-config.ts`) và bot (`ops/zalo-alerts/thi_truong.js`) — sửa thì sửa cả ba.
- Khoá kết nối (token Meta, key POS…) nằm MÃ HOÁ trong bảng `api_credentials`: gọi
  `load_credentials_to_env()` (`sync/core/credentials.py`) lúc bắt đầu, đừng tự đọc file `.env`.

## Ghi kho số

- Nối Postgres qua `sync/core/pg.py`. Ghi bảng hai tầng qua `sync/core/pg_writer.py`: raw chỉ thêm,
  bảng sạch dựng lại trong một transaction. Cấm `DELETE` / `DROP` / `TRUNCATE` lên bảng dữ liệu.
- Việc nền mới trong Docker chạy qua `run_and_log()` của `ops/docker/lich.py` để nó hiện lên đèn
  "Cập nhật lúc…" (bảng `job_runs`).

## Cấu trúc file

- Tối đa **300 dòng/file** (`scripts/hooks/check_file_length.py`, CI cảnh báo). Vượt thì tách module.
- Mỗi file mở đầu bằng docstring tiếng Việt nói file làm gì, vì sao (nghiệp vụ, sự cố đã gặp).
- Có type hint cho tham số và giá trị trả về của hàm public.
- Không `except:` trần — bắt đúng loại lỗi. Lỗi fetch thì để vòng chạy trả rc≠0, đừng nuốt.

## Đặt tên

- Code mới: tên file, hàm, biến, hằng **tiếng Anh** — `snake_case` cho file / hàm / biến,
  `PascalCase` cho class, `UPPER_SNAKE_CASE` cho hằng.
- Chuỗi in ra cho người dùng / tin bot và chú thích giải thích nghiệp vụ: **tiếng Việt**.

## Test

- `tests/test_<module>.py`, dùng pytest (fixture, không `unittest.TestCase`).
- Chạy luôn kèm `TALPHA_RULES` — loader ưu tiên `~/talpha_reports/talpha_rules.json` (bản hệ thống
  cũ còn trên Mac) nên chạy trần là đọc nhầm luật:
  `DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/`
- Test chạm Postgres dựng schema tạm rồi xoá — không đụng bảng thật. Không có `DATABASE_URL` thì tự bỏ qua.
