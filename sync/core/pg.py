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
THU_MUC_MIGRATION = REPO / "db" / "migrations"

# Khoá advisory: hai tiến trình (container migrate + vòng sync) không cùng chạy migration một lúc.
KHOA_MIGRATION = 2026110401


def chuoi_ket_noi() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        raise RuntimeError(
            "chưa đặt DATABASE_URL — chạy trong docker compose, hoặc đặt "
            "DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha")
    return url


def ket_noi(url: str = None):
    """Kết nối autocommit, múi giờ UTC (sync_time của sync là giờ UTC). Ghi nhiều câu thì bọc
    `with conn.transaction():` — lỗi giữa chừng là quay về như cũ."""
    import psycopg

    conn = psycopg.connect(url or chuoi_ket_noi(), autocommit=True)
    conn.execute("SET TIME ZONE 'UTC'")
    return conn


def chay_migrations(conn, thu_muc: Path = THU_MUC_MIGRATION) -> list:
    """Chạy các file migration chưa chạy. Trả danh sách tên file vừa chạy."""
    conn.execute("SELECT pg_advisory_lock(%s)", (KHOA_MIGRATION,))
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " ten text PRIMARY KEY, chay_luc timestamptz NOT NULL DEFAULT now())")
        da_chay = {r[0] for r in conn.execute("SELECT ten FROM schema_migrations")}
        moi = []
        for f in sorted(Path(thu_muc).glob("*.sql")):
            if f.name in da_chay:
                continue
            with conn.transaction():
                conn.execute(f.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (ten) VALUES (%s)", (f.name,))
            moi.append(f.name)
        return moi
    finally:
        conn.execute("SELECT pg_advisory_unlock(%s)", (KHOA_MIGRATION,))


def dat_mat_khau_vai_doc(conn) -> bool:
    """Cho hai vai chỉ đọc (migration 0003) đăng nhập bằng TALPHA_DOC_PASSWORD — cổng /api/query của
    dashboard đăng nhập bằng chúng. Không đặt biến → giữ NOLOGIN, /api/query từ chối chạy."""
    mk = (os.environ.get("TALPHA_DOC_PASSWORD") or "").strip()
    if not mk:
        return False
    for vai in ("talpha_doc", "talpha_doc_nuoc"):
        # ALTER ROLE không nhận tham số $1 — ghép chuỗi đã thoát bằng quote_literal của Postgres.
        lit = conn.execute("SELECT quote_literal(%s)", (mk,)).fetchone()[0]
        conn.execute(f"ALTER ROLE {vai} LOGIN PASSWORD {lit}")
    return True


BANG_DEM = ("sale_order", "order_items", "fb_ads_tat_ca", "fb_adset_tat_ca",
            "fb_campaign_tat_ca", "ad_dictionary", "partner_orders")


def dem_bang(conn) -> list:
    """[(bảng, số dòng, sync gần nhất)] — xem nhanh số mới có về không."""
    out = []
    for b in BANG_DEM:
        cot = "synced_at::text" if b == "partner_orders" else "sync_time"
        n, moi_nhat = conn.execute(f"SELECT COUNT(*), MAX({cot}) FROM {b}").fetchone()
        out.append((b, n, moi_nhat))
    n, moi_nhat = conn.execute("SELECT COUNT(*), MAX(thay_lan_cuoi)::text FROM tkqc").fetchone()
    out.append(("tkqc", n, moi_nhat))
    # Dữ liệu người dùng nhập (migration 0006) — cột "sync gần nhất" là lần sửa gần nhất.
    for b, cot in (("app_documents", "updated_at"), ("market_overrides", "updated_at"),
                   ("market_monthly_reports", "written_at"), ("users", "updated_at"),
                   ("api_credentials", "updated_at")):
        if conn.execute("SELECT to_regclass(%s)", (b,)).fetchone()[0] is None:
            continue
        n, moi_nhat = conn.execute(f"SELECT COUNT(*), MAX({cot})::text FROM {b}").fetchone()
        out.append((b, n, moi_nhat))
    return out


def main(argv) -> int:
    lenh = argv[1] if len(argv) > 1 else "migrate"
    with ket_noi() as conn:
        if lenh == "migrate":
            moi = chay_migrations(conn)
            print("Đã chạy: " + ", ".join(moi) if moi else "Không còn migration nào chưa chạy.")
            # File cũ (data/*.json, users.json, .env.khoa.local) → bảng — mỗi file một lần (nhap_file.py).
            from sync.core.nhap_file import chep_tat_ca
            chep = chep_tat_ca(conn)
            if chep:
                print("Đã chép vào kho: " + ", ".join(chep))
            if not dat_mat_khau_vai_doc(conn):
                print("Chưa đặt TALPHA_DOC_PASSWORD — 4 tab dùng /api/query (Marketing, Sức khoẻ QC, "
                      "Khách hàng, Market Intel) sẽ báo chưa cấu hình.")
            from sync.core.pg_view import dung_view
            print("Đã dựng lại bộ view theo luật hiện tại." if dung_view(conn) else "View đang khớp luật.")
        elif lenh == "view":
            from sync.core.pg_view import dung_view
            print("Đã dựng lại bộ view." if dung_view(conn, ep="--ep" in argv) else "View đang khớp luật.")
        elif lenh == "dem":
            for b, n, moi_nhat in dem_bang(conn):
                print(f"  {b:<22} {n:>8} dòng   sync gần nhất: {moi_nhat or '—'}")
        else:
            print(f"Lệnh lạ {lenh!r} — dùng: migrate | dem", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
