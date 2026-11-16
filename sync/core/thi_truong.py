"""
Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.

talpha_rules.json nằm trong git, mà máy chủ lấy code bằng `reset --hard origin/main` — sửa nó trên
trang là lần deploy sau mất. Nên nước thêm / sửa / tắt trên trang nằm ở bảng PHỦ `market_overrides`
(15/11/2026 — trước đó file data/thi_truong.json), và mọi nơi đọc luật phủ bảng đó lên bản gốc. Bản
này cho Python (sync, view Postgres, vòng ghi báo cáo); bản dashboard ở
dashboard-ui/src/lib/talpha/market-config.ts, bản bot ở ops/zalo-alerts/thi_truong.js. Ba bản phải ra
CÙNG kết quả — bộ dữ liệu chung tests/fixtures/thi_truong_phu.json.

Mỗi lần chạy (mỗi vòng sync, mỗi vòng ghi Sheet) là một tiến trình mới nên đọc lại bảng phủ —
lưu trên trang xong thì vòng kế tiếp dùng ngay.

TALPHA_THI_TRUONG (chỉ cho test) trỏ vào một FILE phủ thay cho bảng — test soát luật của repo,
không phải thị trường ai đó nhập trên máy đang chạy test.
"""
import copy
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# Hai ô chỉ có trong file phủ: mã trên tên campaign, team phụ trách — đổ vào chỗ của chúng trong
# luật gốc (market_aliases + camp_market_tokens, access.teams), không nằm trong khối nước.
OVERRIDE_ONLY_FIELDS = ("tokens", "team")


def _read_override_file(p: str):
    """File phủ của test (TALPHA_THI_TRUONG). Không có file = chưa ai nhập."""
    if not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  {p} hỏng định dạng ({e}) — bỏ qua thị trường nhập trên trang", file=sys.stderr)
        return None


def read_market_overrides_from_db(conn) -> dict:
    """{"markets": {nước: khối}} từ bảng market_overrides — cùng dạng file phủ cũ."""
    rows = conn.execute("SELECT market_key, settings FROM market_overrides ORDER BY market_key").fetchall()
    return {"markets": {k: v for k, v in rows}}


def load_market_overrides(repo=None):
    """Phần phủ, hoặc None nếu chưa ai nhập. Kho lỗi thì KÊU và bỏ qua — không được làm sập cả
    vòng sync (chạy bằng luật gốc, và dòng cảnh báo nằm trong log của vòng đó)."""
    path = os.environ.get("TALPHA_THI_TRUONG")
    if path:
        return _read_override_file(path)
    if not (os.environ.get("DATABASE_URL") or "").strip():
        return None
    try:
        from sync.core.pg import get_connection
        with get_connection() as conn:
            overrides = read_market_overrides_from_db(conn)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  không đọc được market_overrides ({e}) — bỏ qua thị trường nhập trên trang", file=sys.stderr)
        return None
    return overrides if overrides["markets"] else None


def apply_market_overrides(rules: dict, overrides) -> dict:
    """Phủ file thị trường lên luật gốc. Không sửa `luat` truyền vào.

    Mỗi nước: ô trong file phủ đè ô cùng tên của bản gốc, ô không nhắc tới giữ nguyên. Mã campaign
    đang thuộc nước KHÁC không bị giành — chi tiêu nước đó không được nhảy sang nước mới. Nước có
    `team` thì chỉ nằm ở đúng team đó."""
    out = copy.deepcopy(rules)
    markets = out.setdefault("markets", {})
    aliases = out.setdefault("market_aliases", {})
    tokens = out.setdefault("camp_market_tokens", [])
    teams = (out.get("access") or {}).get("teams") or {}
    for key, settings in ((overrides or {}).get("markets") or {}).items():
        if key.startswith("_") or not isinstance(settings, dict):
            continue
        merged = dict(markets[key]) if isinstance(markets.get(key), dict) else {}
        merged.update({k: v for k, v in settings.items() if k not in OVERRIDE_ONLY_FIELDS})
        markets[key] = merged

        for t in settings.get("tokens") or []:
            T = str(t).strip().upper()
            if not T:
                continue
            owner = aliases.get(T)
            if owner and owner != key:
                continue
            aliases[T] = key
            if T not in tokens:
                tokens.append(T)

        team = settings.get("team")
        if isinstance(team, str) and isinstance(teams.get(team), dict):
            for team_name, t in teams.items():
                if not isinstance(t, dict):
                    continue
                ds = t["markets"] if isinstance(t.get("markets"), list) else []
                t["markets"] = (ds if key in ds else ds + [key]) if team_name == team else [m for m in ds if m != key]
    return out


def load_rules(base_path=None, repo=None) -> dict:
    """talpha_rules.json (mặc định của repo) ĐÃ phủ thị trường nhập trên trang."""
    rules_path = base_path or str(Path(repo or REPO) / "config" / "talpha_rules.json")
    with open(rules_path, encoding="utf-8") as fh:
        rules = json.load(fh)
    return apply_market_overrides(rules, load_market_overrides(repo))
