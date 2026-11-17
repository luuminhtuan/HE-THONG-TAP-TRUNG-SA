#!/usr/bin/env bash
#
# Dựng nền kho số POSTGRES trên máy chủ (16/11/2026 — main thành bản Postgres). Chạy TRÊN MÁY CHỦ, quyền root,
# chạy lại nhiều lần không hỏng:
#
#     bash ops/deploy/vps-postgres-setup.sh prepare   # production (bản BigQuery) VẪN chạy trong lúc làm
#     bash ops/deploy/vps-postgres-setup.sh units     # việc nền systemd chạy bản Postgres — làm lúc chuyển
#
# prepare:
#   1. pgcrypto — gói postgresql-contrib. Bản contrib trong kho gói thường MỚI hơn Postgres đang chạy (16.8 → 16.15):
#      dnf nâng luôn Postgres (cùng dòng 16, không phải chuyển dữ liệu) và phải KHỞI ĐỘNG LẠI Postgres — mọi database
#      khác trên máy (banbot…) chớp vài giây.
#   2. pg_hba: thêm dòng cho RIÊNG database talpha (đăng nhập bằng mật khẩu qua 127.0.0.1), đặt TRƯỚC các dòng sẵn có;
#      không sửa dòng nào của database khác.
#   3. Role talpha (LOGIN, CREATEROLE — migration tạo vai chỉ đọc và đặt mật khẩu cho chúng) + database talpha + hai
#      vai chỉ đọc (tạo BẰNG talpha để talpha quản được chúng — Postgres 16 chỉ cho người tạo đổi mật khẩu vai đó).
#   4. Khoá trong dashboard-ui/.env.local: DATABASE_URL, TALPHA_ENCRYPTION_KEY, TALPHA_READONLY_PASSWORD — SINH NGAY
#      TRÊN MÁY CHỦ, không in ra, không rời máy. Đã có thì giữ (chạy lại không đổi chìa — đổi chìa là khoá đã lưu
#      không giải mã được nữa).
#   5. venv Python 3.12 mới ở .venv312 (bản Postgres cần ≥ 3.10 + psycopg); .venv cũ (3.9, bản BigQuery) để nguyên
#      tới lúc chuyển — quay lui là đổi tên lại.
#
# units (lúc chuyển, SAU khi đổi .venv312 → .venv): việc ghi báo cáo chạy thẳng ops/talpha_reports/daily_guarded.sh trong
#   repo (bản Postgres) thay bản chép riêng /root/talpha_reports/runtime — bằng drop-in systemd, xoá drop-in là về như cũ.
#   Sync / danh mục / tồn kho / vận đơn không đổi lệnh: cùng đường dẫn .venv, cùng gọi API dashboard.
#
# Biến: APP_DIR (/opt/talpha) · PY_BIN (python3.12) · REQ (requirements.txt — lúc prepare máy chủ còn code cũ thì
#   chép requirements.txt bản mới lên rồi trỏ REQ vào đó).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/talpha}"
ENV_FILE="$APP_DIR/dashboard-ui/.env.local"
PY_BIN="${PY_BIN:-python3.12}"
REQ="${REQ:-$APP_DIR/requirements.txt}"

say()  { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;35m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
pg()   { sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"; }
env_get() { sed -nE "s/^$1=[\"']?([^\"' ]*)[\"']?\$/\\1/p" "$ENV_FILE" 2>/dev/null | tail -1; }
env_add() {   # thêm KEY=giá trị vào cuối .env.local — KHÔNG in giá trị
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
    echo "   + $1 (sinh trên máy chủ)"
}

prepare() {
    [ "$(id -u)" = 0 ] || die "Chạy bằng root"
    [ -f "$ENV_FILE" ] || die "Thiếu $ENV_FILE"
    systemctl is-active --quiet postgresql || die "Postgres chưa chạy (systemctl status postgresql)"

    say "1/5 · pgcrypto"
    if [ "$(pg -c "SELECT count(*) FROM pg_available_extensions WHERE name = 'pgcrypto'")" = 1 ]; then
        echo "   đã có"
    else
        before=$(rpm -q postgresql-server)
        dnf install -y -q postgresql-contrib
        after=$(rpm -q postgresql-server)
        if [ "$before" != "$after" ]; then
            echo "   Postgres nâng $before → $after — khởi động lại (database khác chớp vài giây)"
            systemctl restart postgresql
            for _ in $(seq 1 30); do sudo -u postgres pg_isready -q && break; sleep 1; done
            sudo -u postgres pg_isready -q || die "Postgres chưa lên lại sau khi nâng — xem journalctl -u postgresql"
        fi
        [ "$(pg -c "SELECT count(*) FROM pg_available_extensions WHERE name = 'pgcrypto'")" = 1 ] || die "Cài xong vẫn chưa thấy pgcrypto"
        echo "   xong"
    fi

    say "2/5 · pg_hba — talpha đăng nhập bằng mật khẩu (dòng của database khác giữ nguyên)"
    HBA=$(pg -c "SHOW hba_file")
    if grep -q '# talpha (vps-postgres-setup)' "$HBA"; then
        echo "   đã có"
    else
        cp -a "$HBA" "$HBA.bak-$(date +%Y%m%d-%H%M%S)"
        awk 'BEGIN { done = 0 }
             !done && /^[[:space:]]*(local|host)/ {
                 print "# talpha (vps-postgres-setup) — dashboard + sync của TALPHA đăng nhập bằng mật khẩu qua 127.0.0.1"
                 print "host    talpha    talpha,talpha_readonly,talpha_readonly_market    127.0.0.1/32    scram-sha-256"
                 print "host    talpha    talpha,talpha_readonly,talpha_readonly_market    ::1/128         scram-sha-256"
                 done = 1
             }
             { print }' "$HBA" > "$HBA.new"
        cat "$HBA.new" > "$HBA" && rm -f "$HBA.new"
        pg -c "SELECT pg_reload_conf()" >/dev/null
        echo "   đã thêm (bản cũ: $HBA.bak-*)"
    fi

    say "3/5 · Role + database talpha"
    PW=$(env_get DATABASE_URL | sed -nE 's#^postgresql://talpha:([^@]+)@.*#\1#p')
    NEW_URL=0
    if [ -z "$PW" ]; then PW=$(openssl rand -hex 24); NEW_URL=1; fi
    # Mật khẩu đi qua stdin (không nằm trên dòng lệnh — ps của người khác không thấy).
    pg <<SQL
SET password_encryption = 'scram-sha-256';
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha') THEN CREATE ROLE talpha LOGIN CREATEROLE; END IF;
END \$\$;
ALTER ROLE talpha WITH LOGIN CREATEROLE PASSWORD '$PW';
SQL
    if [ "$(pg -c "SELECT count(*) FROM pg_database WHERE datname = 'talpha'")" = 0 ]; then
        pg -c "CREATE DATABASE talpha OWNER talpha ENCODING 'UTF8' TEMPLATE template0"
        echo "   tạo database talpha"
    else
        echo "   database talpha đã có"
    fi
    pg -d talpha <<'SQL'
SET ROLE talpha;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha_readonly') THEN CREATE ROLE talpha_readonly NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talpha_readonly_market') THEN CREATE ROLE talpha_readonly_market NOLOGIN; END IF;
END $$;
SQL
    echo "   role talpha + 2 vai chỉ đọc sẵn sàng"

    say "4/5 · Khoá trong .env.local (không in giá trị)"
    cp -a "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
    [ "$NEW_URL" = 1 ] && env_add DATABASE_URL "postgresql://talpha:$PW@127.0.0.1:5432/talpha"
    [ -n "$(env_get TALPHA_ENCRYPTION_KEY)" ] || env_add TALPHA_ENCRYPTION_KEY "$(openssl rand -hex 32)"
    [ -n "$(env_get TALPHA_READONLY_PASSWORD)" ] || env_add TALPHA_READONLY_PASSWORD "$(openssl rand -hex 24)"
    chmod 600 "$ENV_FILE"
    PGPASSWORD="$PW" psql -qAt -h 127.0.0.1 -U talpha -d talpha -c "SELECT 'đăng nhập talpha qua 127.0.0.1: được'" \
        || die "talpha chưa đăng nhập được bằng mật khẩu — xem $HBA"

    say "5/5 · Python 3.12 + thư viện → $APP_DIR/.venv312"
    command -v "$PY_BIN" >/dev/null || die "Không có $PY_BIN"
    [ -f "$REQ" ] || die "Không thấy $REQ"
    [ -x "$APP_DIR/.venv312/bin/python" ] || "$PY_BIN" -m venv "$APP_DIR/.venv312"
    "$APP_DIR/.venv312/bin/pip" install -q --upgrade pip
    "$APP_DIR/.venv312/bin/pip" install -q -r "$REQ"
    "$APP_DIR/.venv312/bin/python" -c "import psycopg, sys; print('   ' + sys.version.split()[0] + ' · psycopg ' + psycopg.__version__)"

    say "XONG phần chuẩn bị — production chưa đổi gì (dashboard, sync, bot vẫn chạy bản cũ)"
}

units() {
    [ "$(id -u)" = 0 ] || die "Chạy bằng root"
    [ -f "$APP_DIR/ops/talpha_reports/daily_guarded.sh" ] || die "Máy chủ chưa có code bản Postgres ($APP_DIR)"
    "$APP_DIR/.venv/bin/python" -c "import psycopg" 2>/dev/null || die "$APP_DIR/.venv chưa phải venv bản Postgres (đổi .venv312 → .venv trước)"

    say "Báo cáo tháng chạy bản trong repo (drop-in talpha-report.service.d/postgres.conf)"
    install -d /etc/systemd/system/talpha-report.service.d
    cat > /etc/systemd/system/talpha-report.service.d/postgres.conf <<UNIT
# vps-postgres-setup.sh units (16/11/2026): bản Postgres ghi báo cáo bằng ops/talpha_reports trong repo — không dùng
# bản chép riêng /root/talpha_reports/runtime của thời BigQuery nữa. Xoá file này + daemon-reload là về như cũ.
[Service]
Environment=TALPHA_REPORTS_DIR=$APP_DIR/ops/talpha_reports
Environment=TALPHA_RUNTIME_DIR=$APP_DIR
Environment=TALPHA_PYTHON=$APP_DIR/.venv/bin/python
Environment=TALPHA_REPO=$APP_DIR
ExecStart=
ExecStart=/bin/bash $APP_DIR/ops/talpha_reports/daily_guarded.sh
UNIT
    # Mỗi PHÚT với --if-due (17/11/2026): script thoát ngay nếu không ai bấm "Tải tin mới" và lượt gần nhất chưa quá
    # pancake_inbox.sync_every_minutes (30) — bấm nút là có tin trong ~1 phút, không ai bấm thì 30 phút một lượt.
    say "Hộp thư Pancake — talpha-pancake.timer mỗi phút, kéo thật theo pancake_inbox.sync_every_minutes hoặc khi bấm Tải tin mới"
    cat > /etc/systemd/system/talpha-pancake.service <<UNIT
[Unit]
Description=TALPHA — kéo hội thoại + tin nhắn Pancake vào Postgres (tab Tin nhắn)
After=network-online.target postgresql.service

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/dashboard-ui/.env.local
ExecStart=$APP_DIR/.venv/bin/python $APP_DIR/sync/talpha/pancake_inbox_sync.py --if-due
TimeoutStartSec=600
UNIT
    cat > /etc/systemd/system/talpha-pancake.timer <<UNIT
[Unit]
Description=TALPHA — hộp thư Pancake (hỏi mỗi phút: có ai bấm Tải tin mới / tới lượt tự kéo chưa)

[Timer]
OnCalendar=*:*:00
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT
    # Loader luật Python (ops/talpha_reports/talpha_rules.py) ưu tiên ~/talpha_reports/talpha_rules.json nếu có — trên
    # máy chủ đó là bản chép của thời BigQuery (khoá cũ: dang_ban…), đọc nhầm là số sai. Chỉ thẳng luật trong repo.
    for s in talpha-sync talpha-report talpha-tracking talpha-snapshot talpha-catalog talpha-pancake; do
        install -d "/etc/systemd/system/$s.service.d"
        printf '# vps-postgres-setup.sh units: luật trong repo, không phải bản chép ~/talpha_reports/talpha_rules.json\n[Service]\nEnvironment=TALPHA_RULES=%s/config/talpha_rules.json\n' \
            "$APP_DIR" > "/etc/systemd/system/$s.service.d/talpha-rules.conf"
    done
    systemctl daemon-reload
    systemctl cat talpha-report.service | grep -E '^ExecStart=/' | tail -1 | sed 's/^/   /'
    systemctl show talpha-sync.service -p Environment --value | tr ' ' '\n' | grep '^TALPHA_RULES=' | sed 's/^/   /'
    systemctl enable --now talpha-pancake.timer >/dev/null 2>&1 && echo "   talpha-pancake.timer: bật"
    say "XONG — bật lại timer: systemctl start talpha-sync.timer talpha-report.timer talpha-tracking.timer talpha-snapshot.timer talpha-catalog.timer talpha-pancake.timer"
}

case "${1:-}" in
    prepare) prepare ;;
    units) units ;;
    *) echo "dùng: $0 prepare | units" >&2; exit 2 ;;
esac
