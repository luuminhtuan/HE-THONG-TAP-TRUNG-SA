"""
Chép dữ liệu còn nằm ở file vào Postgres (15/11/2026, migration 0001) — chạy ở bước `migrate`.

  data/<kho>.json            → app_documents           (sao kê COD, việc đối soát, thanh toán QC, vận đơn…)
  data/thi_truong.json       → market_overrides
  data/bao_cao_nuoc/*.json   → market_monthly_reports
  config/users.json | USERS_JSON → users
  dashboard-ui/.env.khoa.local → api_credentials      (mã hoá — cần TALPHA_ENCRYPTION_KEY)

Mỗi file chỉ chép MỘT lần (sổ `file_imports`): sau đó kho là bản thật, file chỉ còn là bản lưu cũ.
Chép lại lần hai sẽ làm sống lại thứ người dùng đã xoá trên trang (vd khoá đã bỏ). Dòng đã có
trong kho KHÔNG bị ghi đè. File không bị xoá.

  python -m sync.core.file_import          # như bước migrate
"""
import json
import os
import re
import sys
from pathlib import Path

from psycopg.types.json import Jsonb

REPO = Path(__file__).resolve().parents[2]
DOC_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
ENV_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
ENV_COMMENT_RE = re.compile(r"^# ([A-Za-z_][A-Za-z0-9_]*): (.*)$")


def _already_imported(conn, source: str) -> bool:
    return conn.execute("SELECT 1 FROM file_imports WHERE source = %s", (source,)).fetchone() is not None


def _mark_imported(conn, source: str, detail: str) -> None:
    conn.execute("INSERT INTO file_imports (source, detail) VALUES (%s, %s) ON CONFLICT (source) DO NOTHING",
                 (source, detail))


def _read_json(p: Path):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


# File của bản chạy bằng file (máy chủ VPS trước khi chuyển Postgres) mang tên tiếng Việt → tên dòng
# app_documents mà code đọc (đặt tiếng Anh 16/11/2026). Nhập vào tên cũ thì code không thấy dòng đó.
LEGACY_DOC_NAMES = {"chi_phi_van_hanh": "operating_expenses", "ads_recon_kho": "ads_recon_rows"}


def import_app_documents(conn, repo: Path) -> list:
    out = []
    folder = repo / "data"
    for p in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        name = LEGACY_DOC_NAMES.get(p.stem, p.stem)
        source = f"data/{p.name}"
        if p.name == "thi_truong.json" or not DOC_NAME_RE.match(name) or _already_imported(conn, source):
            continue
        with conn.transaction():
            conn.execute("INSERT INTO app_documents (name, content) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
                         (name, Jsonb(_read_json(p))))
            _mark_imported(conn, source, f"app_documents.{name}")
        out.append(source)
    return out


# data/thi_truong.json của bản chạy bằng file ghi trạng thái / khoá tiếng Việt. Ba bộ đọc luật (dashboard
# rules.ts, sync market_config / pos_shops, bot rules.js) chỉ hiểu giá trị hiện tại — chép nguyên là nước
# "dang_ban" ngừng kéo đơn POS, nước "da_tat" hiện thành đang bán trên form /admin (16/11/2026).
LEGACY_MARKET_STATUS = {"dang_ban": "active", "sap_chay": "upcoming", "da_tat": "disabled"}
LEGACY_MARKET_KEYS = {"nguoi_cam": "owner"}


def normalize_legacy_market_settings(settings: dict) -> dict:
    """Phần phủ một nước từ file cũ → khoá / giá trị hiện tại. Khoá mới đã có thì thắng khoá cũ; giá trị lạ để nguyên."""
    out = {}
    for key, value in settings.items():
        new_key = LEGACY_MARKET_KEYS.get(key, key)
        if new_key != key and new_key in settings:
            continue
        out[new_key] = value
    if out.get("status") in LEGACY_MARKET_STATUS:
        out["status"] = LEGACY_MARKET_STATUS[out["status"]]
    return out


def import_market_overrides(conn, repo: Path) -> list:
    p = repo / "data" / "thi_truong.json"
    source = "data/thi_truong.json"
    if not p.is_file() or _already_imported(conn, source):
        return []
    overrides = _read_json(p)
    updated_by = overrides.get("updated_by")
    n = 0
    with conn.transaction():
        for key, settings in (overrides.get("markets") or {}).items():
            if key.startswith("_") or not isinstance(settings, dict) or not settings:
                continue
            conn.execute(
                "INSERT INTO market_overrides (market_key, settings, updated_by) VALUES (%s, %s, %s) "
                "ON CONFLICT (market_key) DO NOTHING", (key, Jsonb(normalize_legacy_market_settings(settings)), updated_by))
            n += 1
        _mark_imported(conn, source, f"market_overrides: {n} nước")
    return [source]


def import_market_reports(conn, repo: Path) -> list:
    out = []
    directory = repo / "data" / "bao_cao_nuoc"
    for p in sorted(directory.glob("*.json")) if directory.is_dir() else []:
        source = f"data/bao_cao_nuoc/{p.name}"
        if not re.match(r"^\d{4}-\d{2}$", p.stem) or _already_imported(conn, source):
            continue
        with conn.transaction():
            conn.execute(
                "INSERT INTO market_monthly_reports (month, content) VALUES (%s, %s) ON CONFLICT (month) DO NOTHING",
                (p.stem, Jsonb(_read_json(p))))
            _mark_imported(conn, source, f"market_monthly_reports.{p.stem}")
        out.append(source)
    return out


def import_users(conn, repo: Path) -> list:
    p = repo / "config" / "users.json"
    if p.is_file():
        source, ds = "config/users.json", _read_json(p)
    elif (os.environ.get("USERS_JSON") or "").strip():
        source, ds = "env:USERS_JSON", json.loads(os.environ["USERS_JSON"])
    else:
        return []
    if _already_imported(conn, source):
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
        _mark_imported(conn, source, f"users: {n} tài khoản")
    return [source]


def parse_credentials_file(text: str) -> tuple:
    """(khoá, ghi chú) của file .env.khoa.local: dòng TÊN=giá trị, ghi chú ở dòng `# TÊN: …` ngay trên."""
    credentials, notes = {}, {}
    for line in text.splitlines():
        m = ENV_COMMENT_RE.match(line)
        if m:
            notes[m.group(1)] = m.group(2).strip()
            continue
        m = ENV_LINE_RE.match(line)
        if m:
            v = m.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            if v:
                credentials[m.group(1)] = v
    return credentials, notes


def import_credentials(conn, repo: Path) -> list:
    p = repo / "dashboard-ui" / ".env.khoa.local"
    source = "dashboard-ui/.env.khoa.local"
    if not p.is_file() or _already_imported(conn, source):
        return []
    from sync.core.credentials import get_encryption_key, save_credential
    if not get_encryption_key():
        # Không đánh dấu: đặt chìa xong, lần migrate sau tự chép.
        print("⚠️  có dashboard-ui/.env.khoa.local nhưng chưa đặt TALPHA_ENCRYPTION_KEY — chưa chép khoá vào kho",
              file=sys.stderr)
        return []
    credentials, note = parse_credentials_file(p.read_text(encoding="utf-8"))
    n = 0
    with conn.transaction():
        for name, value in credentials.items():
            if conn.execute("SELECT 1 FROM api_credentials WHERE name = %s", (name,)).fetchone():
                continue
            save_credential(conn, name, value, note.get(name, ""), "chép từ .env.khoa.local")
            n += 1
        _mark_imported(conn, source, f"api_credentials: {n} khoá")
    return [source]


def import_all(conn, repo: Path = REPO) -> list:
    """Chép mọi file chưa chép. Trả danh sách nguồn vừa chép. Một file hỏng chỉ KÊU, không chặn bước
    migrate (dashboard chờ bước này xong mới bật) — file đó chưa đánh dấu nên lần sau thử lại."""
    out = []
    for step in (import_app_documents, import_market_overrides, import_market_reports, import_users, import_credentials):
        try:
            out += step(conn, Path(repo))
        except Exception as e:  # noqa: BLE001
            print(f"⚠️  {step.__name__}: chưa chép được ({e})", file=sys.stderr)
    return out


def main() -> int:
    from sync.core.pg import get_connection
    with get_connection() as conn:
        imported = import_all(conn)
    print("Đã chép vào kho: " + ", ".join(imported) if imported else "Không còn file nào chưa chép vào kho.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
