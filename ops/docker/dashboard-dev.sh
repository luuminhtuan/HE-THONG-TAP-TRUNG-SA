#!/bin/sh
# Dashboard trong docker compose (04/11/2026, docs/POSTGRES.md) — `next dev`, sửa code là thấy ngay.
#
# node_modules nằm trong volume riêng của container (bản Linux), KHÔNG dùng node_modules của máy Mac:
# gói có phần dịch sẵn theo hệ điều hành (Next SWC, lightningcss…) chép sang là dashboard không lên.
# Chỉ cài lại khi package-lock.json đổi. `npm ci` của npm 8+ xoá NỘI DUNG node_modules chứ không xoá
# chính thư mục, nên chạy được trên volume.
set -e
cd /app/dashboard-ui

MOC=node_modules/.package-lock.sha
MOI=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f "$MOC" ] || [ "$(cat "$MOC")" != "$MOI" ]; then
    echo "Cài thư viện dashboard (lần đầu, hoặc package-lock.json vừa đổi)…"
    npm ci --no-audit --no-fund
    echo "$MOI" > "$MOC"
fi

exec node_modules/.bin/next dev -H 0.0.0.0 -p 3000
