# Lệnh AI được tự chạy — và lệnh CẤM tự chạy

Danh sách cho dự án TALPHA (Next.js 16 + Postgres trong docker compose + sync Python + bot Zalo).
Lệnh ngoài danh sách "được chạy" thì hỏi trước.

## Được tự chạy

### Đọc, tìm, xem trạng thái
- `ls`, `pwd`, `cat`, `head`, `tail`, `grep`, `find`, `wc`, `tree`
- `git status`, `git diff`, `git log`, `git branch`, `git show`, `git worktree list`

### Docker — xem và bật
- `docker compose ps`, `docker compose logs -f scheduler | dashboard | db`
- `docker compose up -d` (bật Postgres + dashboard http://localhost:3200 + lịch việc nền); lần đầu chạy bản sau
  16/11/2026 thì `docker compose up -d --remove-orphans` (service lịch đổi tên `lich` → `scheduler`, bỏ container cũ)
- `docker compose restart scheduler` (chạy ngay một vòng kéo số + dựng báo cáo)
- `docker compose run --rm migrate dem` (số dòng từng bảng + lần sync gần nhất)
- `docker ps`, `docker logs <container>`

### Kiểm thử
- `cd dashboard-ui && npm test` — logic đối soát, vận đơn, sổ đơn
- `cd dashboard-ui && npx tsc --noEmit` — kiểm kiểu
- `cd dashboard-ui && npm run lint`, `npm run build`
- `cd ops/zalo-alerts && npm test` — bot Zalo (không gọi mạng, không đăng nhập)
- Python — LUÔN kèm `TALPHA_RULES` (thiếu là đọc nhầm luật hệ thống cũ còn trên Mac):
  `DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/`
  Máy Mac chỉ có Python 3.9 — chạy trong image `talpha-sync` (Python 3.12) nếu thiếu.

### Cài thư viện
- `npm ci` / `npm install` trong `dashboard-ui/`, `ops/zalo-alerts/`
- `pip install -r requirements.txt` trong venv

### Chẩn đoán số (chỉ đọc)
- `python3 ops/talpha_reports/check_meta_token.py` — token Meta còn sống không, TKQC nào đọc được
- `curl` các route đọc của dashboard (`/api/talpha/sync-health`, `/api/talpha/refresh`…)
- `SELECT` lên kho số

## CẤM tự chạy — phải được dặn rõ

- `DELETE` / `DROP` / `TRUNCATE` lên bảng dữ liệu Postgres, bất kể qua `psql`, `docker exec` hay code
- `docker compose down -v`, `docker volume rm` — xoá volume `pgdata` = mất cả kho số
- Sửa hoặc đổi tên file migration đã chạy trong `db/migrations/`
- `git push`, `git merge`, `git reset --hard`, `git clean`, `git stash` trần (nhiều phiên dùng chung)
- `git add -A` / `git add .` — chỉ add đúng file mình sửa
- Deploy: `bash ops/deploy/from-mac.sh`, `deploy_runtime.sh`, mọi lệnh `ssh root@139.180.131.21` có ghi
- `pm2 restart all` (đụng cả dự án khác trên máy chủ) — dùng `pm2 restart talpha` khi được dặn
- `rm -rf`, `docker rm`, `docker rmi`
- Commit `.env*`, `bigquery_key.json`, `data/`, `config/manual_data/`
