"""
Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.

talpha_rules.json nằm trong git, mà máy chủ lấy code bằng `reset --hard origin/main` — sửa nó trên
trang là lần deploy sau mất. Nên nước thêm / sửa / tắt trên trang nằm ở bảng PHỦ `market_overrides`
(15/11/2026 — trước đó file data/thi_truong.json), và mọi nơi đọc luật phủ bảng đó lên bản gốc. Bản
này cho Python (sync, view Postgres, vòng ghi báo cáo); bản dashboard ở
dashboard-ui/src/lib/talpha/thi-truong.ts, bản bot ở ops/zalo-alerts/thi_truong.js. Ba bản phải ra
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
CHI_O_FILE_PHU = ("tokens", "team")


def _doc_file_phu(p: str):
    """File phủ của test (TALPHA_THI_TRUONG). Không có file = chưa ai nhập."""
    if not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  {p} hỏng định dạng ({e}) — bỏ qua thị trường nhập trên trang", file=sys.stderr)
        return None


def doc_phu_tu_kho(conn) -> dict:
    """{"markets": {nước: khối}} từ bảng market_overrides — cùng dạng file phủ cũ."""
    rows = conn.execute("SELECT market_key, settings FROM market_overrides ORDER BY market_key").fetchall()
    return {"markets": {k: v for k, v in rows}}


def doc_phu(repo=None):
    """Phần phủ, hoặc None nếu chưa ai nhập. Kho lỗi thì KÊU và bỏ qua — không được làm sập cả
    vòng sync (chạy bằng luật gốc, và dòng cảnh báo nằm trong log của vòng đó)."""
    tep = os.environ.get("TALPHA_THI_TRUONG")
    if tep:
        return _doc_file_phu(tep)
    if not (os.environ.get("DATABASE_URL") or "").strip():
        return None
    try:
        from sync.core.pg import ket_noi
        with ket_noi() as conn:
            phu = doc_phu_tu_kho(conn)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  không đọc được market_overrides ({e}) — bỏ qua thị trường nhập trên trang", file=sys.stderr)
        return None
    return phu if phu["markets"] else None


def phu_luat(luat: dict, phu) -> dict:
    """Phủ file thị trường lên luật gốc. Không sửa `luat` truyền vào.

    Mỗi nước: ô trong file phủ đè ô cùng tên của bản gốc, ô không nhắc tới giữ nguyên. Mã campaign
    đang thuộc nước KHÁC không bị giành — chi tiêu nước đó không được nhảy sang nước mới. Nước có
    `team` thì chỉ nằm ở đúng team đó."""
    out = copy.deepcopy(luat)
    markets = out.setdefault("markets", {})
    aliases = out.setdefault("market_aliases", {})
    tokens = out.setdefault("camp_market_tokens", [])
    teams = (out.get("access") or {}).get("teams") or {}
    for key, khoi in ((phu or {}).get("markets") or {}).items():
        if key.startswith("_") or not isinstance(khoi, dict):
            continue
        moi = dict(markets[key]) if isinstance(markets.get(key), dict) else {}
        moi.update({k: v for k, v in khoi.items() if k not in CHI_O_FILE_PHU})
        markets[key] = moi

        for t in khoi.get("tokens") or []:
            T = str(t).strip().upper()
            if not T:
                continue
            cua = aliases.get(T)
            if cua and cua != key:
                continue
            aliases[T] = key
            if T not in tokens:
                tokens.append(T)

        team = khoi.get("team")
        if isinstance(team, str) and isinstance(teams.get(team), dict):
            for tk, t in teams.items():
                if not isinstance(t, dict):
                    continue
                ds = t["markets"] if isinstance(t.get("markets"), list) else []
                t["markets"] = (ds if key in ds else ds + [key]) if tk == team else [m for m in ds if m != key]
    return out


def doc_luat(duong_goc=None, repo=None) -> dict:
    """talpha_rules.json (mặc định của repo) ĐÃ phủ thị trường nhập trên trang."""
    goc = duong_goc or str(Path(repo or REPO) / "config" / "talpha_rules.json")
    with open(goc, encoding="utf-8") as fh:
        luat = json.load(fh)
    return phu_luat(luat, doc_phu(repo))
