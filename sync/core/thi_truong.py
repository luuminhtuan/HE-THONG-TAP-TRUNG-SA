"""
Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.

talpha_rules.json nằm trong git, mà máy chủ lấy code bằng `reset --hard origin/main` — sửa nó trên
trang là lần deploy sau mất. Nên nước thêm / sửa / tắt trên trang nằm ở file PHỦ ngoài git
(<repo>/data/thi_truong.json), và mọi nơi đọc luật phủ file đó lên bản gốc. Bản này cho Python
(sync, view Postgres, vòng ghi báo cáo); bản dashboard ở dashboard-ui/src/lib/talpha/thi-truong.ts,
bản bot ở ops/zalo-alerts/thi_truong.js. Ba bản phải ra CÙNG kết quả — bộ dữ liệu chung
tests/fixtures/thi_truong_phu.json.

Mỗi lần chạy (mỗi vòng sync, mỗi vòng ghi Sheet) là một tiến trình mới nên đọc lại file phủ —
lưu trên trang xong thì vòng kế tiếp dùng ngay.
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


def duong_dan_phu(repo=None) -> str:
    """data/thi_truong.json của repo; TALPHA_THI_TRUONG trỏ chỗ khác (test)."""
    return os.environ.get("TALPHA_THI_TRUONG") or str(Path(repo or REPO) / "data" / "thi_truong.json")


def doc_phu(repo=None):
    """File phủ, hoặc None nếu chưa ai nhập. Hỏng thì KÊU và bỏ qua — một file gõ hỏng không được
    làm sập cả vòng sync."""
    p = duong_dan_phu(repo)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  {p} hỏng định dạng ({e}) — bỏ qua thị trường nhập trên trang", file=sys.stderr)
        return None


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
