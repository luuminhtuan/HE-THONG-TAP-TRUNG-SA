"""
Chép dữ liệu còn nằm ở file vào Postgres (15/11/2026, migration 0006) — chạy ở bước `migrate`.

  data/<kho>.json            → app_documents           (sao kê COD, việc đối soát, thanh toán QC, vận đơn…)
  data/thi_truong.json       → market_overrides
  data/bao_cao_nuoc/*.json   → market_monthly_reports
  config/users.json | USERS_JSON → users
  dashboard-ui/.env.khoa.local → api_credentials      (mã hoá — cần TALPHA_ENCRYPTION_KEY)

Mỗi file chỉ chép MỘT lần (sổ `file_imports`): sau đó kho là bản thật, file chỉ còn là bản lưu cũ.
Chép lại lần hai sẽ làm sống lại thứ người dùng đã xoá trên trang (vd khoá đã bỏ). Dòng đã có
trong kho KHÔNG bị ghi đè. File không bị xoá.

  python -m sync.core.nhap_file          # như bước migrate
"""
import json
import os
import re
import sys
from pathlib import Path

from psycopg.types.json import Jsonb

REPO = Path(__file__).resolve().parents[2]
TEN_KHO = re.compile(r"^[A-Za-z0-9_-]+$")
DONG_ENV = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
GHI_CHU_ENV = re.compile(r"^# ([A-Za-z_][A-Za-z0-9_]*): (.*)$")


def _da_chep(conn, nguon: str) -> bool:
    return conn.execute("SELECT 1 FROM file_imports WHERE source = %s", (nguon,)).fetchone() is not None


def _danh_dau(conn, nguon: str, chi_tiet: str) -> None:
    conn.execute("INSERT INTO file_imports (source, detail) VALUES (%s, %s) ON CONFLICT (source) DO NOTHING",
                 (nguon, chi_tiet))


def _doc_json(p: Path):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def chep_kho_json(conn, repo: Path) -> list:
    out = []
    thu_muc = repo / "data"
    for p in sorted(thu_muc.glob("*.json")) if thu_muc.is_dir() else []:
        ten = p.stem
        nguon = f"data/{p.name}"
        if p.name == "thi_truong.json" or not TEN_KHO.match(ten) or _da_chep(conn, nguon):
            continue
        with conn.transaction():
            conn.execute("INSERT INTO app_documents (name, content) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
                         (ten, Jsonb(_doc_json(p))))
            _danh_dau(conn, nguon, f"app_documents.{ten}")
        out.append(nguon)
    return out


def chep_thi_truong(conn, repo: Path) -> list:
    p = repo / "data" / "thi_truong.json"
    nguon = "data/thi_truong.json"
    if not p.is_file() or _da_chep(conn, nguon):
        return []
    phu = _doc_json(p)
    ai = phu.get("updated_by")
    n = 0
    with conn.transaction():
        for key, khoi in (phu.get("markets") or {}).items():
            if key.startswith("_") or not isinstance(khoi, dict) or not khoi:
                continue
            conn.execute(
                "INSERT INTO market_overrides (market_key, settings, updated_by) VALUES (%s, %s, %s) "
                "ON CONFLICT (market_key) DO NOTHING", (key, Jsonb(khoi), ai))
            n += 1
        _danh_dau(conn, nguon, f"market_overrides: {n} nước")
    return [nguon]


def chep_bao_cao_nuoc(conn, repo: Path) -> list:
    out = []
    thu_muc = repo / "data" / "bao_cao_nuoc"
    for p in sorted(thu_muc.glob("*.json")) if thu_muc.is_dir() else []:
        nguon = f"data/bao_cao_nuoc/{p.name}"
        if not re.match(r"^\d{4}-\d{2}$", p.stem) or _da_chep(conn, nguon):
            continue
        with conn.transaction():
            conn.execute(
                "INSERT INTO market_monthly_reports (month, content) VALUES (%s, %s) ON CONFLICT (month) DO NOTHING",
                (p.stem, Jsonb(_doc_json(p))))
            _danh_dau(conn, nguon, f"market_monthly_reports.{p.stem}")
        out.append(nguon)
    return out


def chep_nguoi_dung(conn, repo: Path) -> list:
    p = repo / "config" / "users.json"
    if p.is_file():
        nguon, ds = "config/users.json", _doc_json(p)
    elif (os.environ.get("USERS_JSON") or "").strip():
        nguon, ds = "env:USERS_JSON", json.loads(os.environ["USERS_JSON"])
    else:
        return []
    if _da_chep(conn, nguon):
        return []
    n = 0
    with conn.transaction():
        for u in ds or []:
            if not u.get("id") or not u.get("email") or not u.get("password"):
                continue
            conn.execute(
                "INSERT INTO users (id, username, name, password_hash, role, teams, projects, status) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (str(u["id"]), str(u["email"]).strip(), u.get("name") or u["email"], u["password"],
                 u.get("role") or "sale", Jsonb(u.get("teams") or []), Jsonb(u.get("projects") or []),
                 u.get("status") if u.get("status") in ("active", "pending") else "active"))
            n += 1
        _danh_dau(conn, nguon, f"users: {n} tài khoản")
    return [nguon]


def doc_file_khoa(text: str) -> tuple:
    """(khoá, ghi chú) của file .env.khoa.local: dòng TÊN=giá trị, ghi chú ở dòng `# TÊN: …` ngay trên."""
    khoa, ghi_chu = {}, {}
    for dong in text.splitlines():
        m = GHI_CHU_ENV.match(dong)
        if m:
            ghi_chu[m.group(1)] = m.group(2).strip()
            continue
        m = DONG_ENV.match(dong)
        if m:
            v = m.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            if v:
                khoa[m.group(1)] = v
    return khoa, ghi_chu


def chep_khoa(conn, repo: Path) -> list:
    p = repo / "dashboard-ui" / ".env.khoa.local"
    nguon = "dashboard-ui/.env.khoa.local"
    if not p.is_file() or _da_chep(conn, nguon):
        return []
    from sync.core.khoa import chia_ma_hoa, ghi_khoa
    if not chia_ma_hoa():
        # Không đánh dấu: đặt chìa xong, lần migrate sau tự chép.
        print("⚠️  có dashboard-ui/.env.khoa.local nhưng chưa đặt TALPHA_ENCRYPTION_KEY — chưa chép khoá vào kho",
              file=sys.stderr)
        return []
    khoa, ghi_chu = doc_file_khoa(p.read_text(encoding="utf-8"))
    n = 0
    with conn.transaction():
        for ten, gia_tri in khoa.items():
            if conn.execute("SELECT 1 FROM api_credentials WHERE name = %s", (ten,)).fetchone():
                continue
            ghi_khoa(conn, ten, gia_tri, ghi_chu.get(ten, ""), "chép từ .env.khoa.local")
            n += 1
        _danh_dau(conn, nguon, f"api_credentials: {n} khoá")
    return [nguon]


def chep_tat_ca(conn, repo: Path = REPO) -> list:
    """Chép mọi file chưa chép. Trả danh sách nguồn vừa chép. Một file hỏng chỉ KÊU, không chặn bước
    migrate (dashboard chờ bước này xong mới bật) — file đó chưa đánh dấu nên lần sau thử lại."""
    out = []
    for buoc in (chep_kho_json, chep_thi_truong, chep_bao_cao_nuoc, chep_nguoi_dung, chep_khoa):
        try:
            out += buoc(conn, Path(repo))
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  {buoc.__name__}: chưa chép được ({e})", file=sys.stderr)
    return out


def main() -> int:
    from sync.core.pg import ket_noi
    with ket_noi() as conn:
        moi = chep_tat_ca(conn)
    print("Đã chép vào kho: " + ", ".join(moi) if moi else "Không còn file nào chưa chép vào kho.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
