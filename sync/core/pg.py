"""
sync/core/pg.py — kết nối Postgres + chạy migration (04/11/2026).

Postgres thay dần BigQuery làm kho số (docs/POSTGRES.md). Chuỗi kết nối ở DATABASE_URL:
docker-compose đặt sẵn cho các container; chạy ngoài Docker thì trỏ vào cổng compose mở ra máy
(mặc định 127.0.0.1:5433).

Migration là file SQL trong db/migrations/, chạy theo thứ tự tên, mỗi file một transaction, ghi tên
vào bảng schema_migrations — như `php artisan migrate`. Chỉ THÊM file mới, đừng sửa file đã chạy:
máy đã chạy file đó sẽ không chạy lại, hai máy ra hai cấu trúc bảng khác nhau.

  python -m sync.core.pg migrate     # chạy migration còn thiếu + dựng lại view nếu luật đổi
  python -m sync.core.pg view [--ep] # chỉ dựng lại view (--ep: dựng dù luật không đổi)
  python -m sync.core.pg dem         # số dòng từng bảng + lần sync gần nhất
"""
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO / "db" / "migrations"

# Khoá advisory: hai tiến trình (container migrate + vòng sync) không cùng chạy migration một lúc.
MIGRATION_LOCK_ID = 2026110401


def get_database_url() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError(
            "chưa đặt DATABASE_URL — chạy trong docker compose, hoặc đặt "
            "DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha")
    return url


def get_connection(url: str = None):
    """Kết nối autocommit, múi giờ UTC (sync_time của sync là giờ UTC). Ghi nhiều câu thì bọc
    `with conn.transaction():` — lỗi giữa chừng là quay về như cũ."""
    import psycopg

    conn = psycopg.connect(url or get_database_url(), autocommit=True)
    conn.execute("SET TIME ZONE 'UTC'")
    return conn


def run_migrations(conn, folder: Path = MIGRATIONS_DIR) -> list:
    """Chạy các file migration chưa chạy. Trả danh sách tên file vừa chạy."""
    conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_ID,))
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        # Kho dựng trước 16/11/2026 có cột tiếng Việt (ten, chay_luc). Đổi ở ĐÂY chứ không trong một file
        # migration: chính hàm này ghi tên file vào bảng ngay sau khi chạy file — đổi trong migration là
        # câu INSERT của lượt đó gãy. Đổi tên cột giữ nguyên dữ liệu, chạy lại không làm gì.
        for old, new in (("ten", "name"), ("chay_luc", "applied_at")):
            conn.execute(
                "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()"
                f" AND table_name = 'schema_migrations' AND column_name = '{old}') THEN"
                f" ALTER TABLE schema_migrations RENAME COLUMN {old} TO {new}; END IF; END $$")
        applied = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
        new_migrations = []
        for f in sorted(Path(folder).glob("*.sql")):
            if f.name in applied:
                continue
            with conn.transaction():
                conn.execute(f.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
            new_migrations.append(f.name)
        return new_migrations
    finally:
        conn.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_ID,))


def set_readonly_role_passwords(conn) -> bool:
    """Cho hai vai chỉ đọc (migration 0008) đăng nhập bằng TALPHA_DOC_PASSWORD — cổng /api/query của
    dashboard đăng nhập bằng chúng. Không đặt biến → giữ NOLOGIN, /api/query từ chối chạy."""
    password = (os.environ.get("TALPHA_DOC_PASSWORD") or "").strip()
    if not password:
        return False
    for role in ("talpha_readonly", "talpha_readonly_market"):
        # ALTER ROLE không nhận tham số $1 — ghép chuỗi đã thoát bằng quote_literal của Postgres.
        lit = conn.execute("SELECT quote_literal(%s)", (password,)).fetchone()[0]
        conn.execute(f"ALTER ROLE {role} LOGIN PASSWORD {lit}")
    return True


COUNTED_TABLES = ("sale_order", "order_items", "fb_ads_all", "fb_adset_all",
            "fb_campaign_all", "ad_dictionary", "partner_orders")


def count_table_rows(conn) -> list:
    """[(bảng, số dòng, sync gần nhất)] — xem nhanh số mới có về không."""
    out = []
    for b in COUNTED_TABLES:
        column = "synced_at::text" if b == "partner_orders" else "sync_time"
        n, latest = conn.execute(f"SELECT COUNT(*), MAX({column}) FROM {b}").fetchone()
        out.append((b, n, latest))
    n, latest = conn.execute("SELECT COUNT(*), MAX(last_seen_at)::text FROM ad_accounts").fetchone()
    out.append(("ad_accounts", n, latest))
    # Dữ liệu người dùng nhập (migration 0006) — cột "sync gần nhất" là lần sửa gần nhất.
    for b, column in (("app_documents", "updated_at"), ("market_overrides", "updated_at"),
                   ("market_monthly_reports", "written_at"), ("users", "updated_at"),
                   ("api_credentials", "updated_at")):
        if conn.execute("SELECT to_regclass(%s)", (b,)).fetchone()[0] is None:
            continue
        n, latest = conn.execute(f"SELECT COUNT(*), MAX({column})::text FROM {b}").fetchone()
        out.append((b, n, latest))
    return out


def main(argv) -> int:
    command = argv[1] if len(argv) > 1 else "migrate"
    with get_connection() as conn:
        if command == "migrate":
            new_migrations = run_migrations(conn)
            print("Đã chạy: " + ", ".join(new_migrations) if new_migrations else "Không còn migration nào chưa chạy.")
            # File cũ (data/*.json, users.json, .env.khoa.local) → bảng — mỗi file một lần (file_import.py).
            from sync.core.file_import import import_all
            imported = import_all(conn)
            if imported:
                print("Đã chép vào kho: " + ", ".join(imported))
            if not set_readonly_role_passwords(conn):
                print("Chưa đặt TALPHA_DOC_PASSWORD — 4 tab dùng /api/query (Marketing, Sức khoẻ QC, "
                      "Khách hàng, Market Intel) sẽ báo chưa cấu hình.")
            from sync.core.pg_view import rebuild_views
            print("Đã dựng lại bộ view theo luật hiện tại." if rebuild_views(conn) else "View đang khớp luật.")
        elif command == "view":
            from sync.core.pg_view import rebuild_views
            print("Đã dựng lại bộ view." if rebuild_views(conn, force="--ep" in argv) else "View đang khớp luật.")
        elif command == "dem":
            for b, n, latest in count_table_rows(conn):
                print(f"  {b:<22} {n:>8} dòng   sync gần nhất: {latest or '—'}")
        else:
            print(f"Lệnh lạ {command!r} — dùng: migrate | dem", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
