# ═══════════════════════════════════════════════════════════════════
# TALPHA — loader rule chung (đọc talpha_rules.json, KHÔNG hard-code rule ở đây)
# Nguồn data: config/talpha_rules.json (repo) / ~/talpha_reports/talpha_rules.json (runtime)
# Consumer: format_all.py (+ script báo cáo khác). Sửa rule → sửa JSON, không sửa file này.
# ═══════════════════════════════════════════════════════════════════
import importlib
import json
import os
import re
import sys

_CANDIDATES = [
    os.environ.get("TALPHA_RULES", ""),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "talpha_rules.json"),
    os.path.expanduser("~/talpha_reports/talpha_rules.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "config", "talpha_rules.json"),
]
RULES_PATH = next((p for p in _CANDIDATES if p and os.path.exists(p)), None)
if not RULES_PATH:
    raise FileNotFoundError("talpha_rules.json không tìm thấy — deploy bằng ops/talpha_reports/deploy_runtime.sh")
with open(RULES_PATH, encoding="utf-8") as _f:
    RULES = json.load(_f)


def _with_market_overrides(rules):
    """Phủ thị trường nhập ở /admin → Thị trường (04/11/2026) lên luật vừa đọc — CÙNG hàm với sync
    (sync/core/market_config.py của repo). Bản chép runtime trên máy chủ tìm repo qua TALPHA_REPO
    (systemd đặt /opt/talpha). Không tìm thấy repo thì KÊU và chạy bằng luật gốc."""
    import sys
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    try:
        import talpha_paths
        repo = talpha_paths.repo_dir()
        if repo not in sys.path:
            sys.path.insert(0, repo)
        from sync.core.market_config import load_market_overrides, apply_market_overrides
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  talpha_rules: không nạp được thị trường nhập trên trang ({e}) — dùng luật gốc", file=sys.stderr)
        return rules
    return apply_market_overrides(rules, load_market_overrides(repo))


RULES = _with_market_overrides(RULES)

# ── Thị trường & tỷ giá (tương đương RATE/LOCALCUR/ALLM/MARKETS/SHOP2MKT cũ) ──
# Nước "sap_chay" chưa có tỷ giá và số chia — khai null
# trong JSON. Ở đây null → tỷ giá 0 (doanh thu 0, KHÔNG đoán) và số chia 1 (chưa có đơn
# nào để chia). Nước "dang_ban" thiếu hai số này là cấu hình sai — test chặn trước deploy.
def _positive_or(v, default):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else default

_MK = {m: v for m, v in RULES["markets"].items() if isinstance(v, dict)}
RATE     = {m: _positive_or(v.get("rate_vnd"), 0) for m, v in _MK.items()}
LOCALCUR = {m: v["currency"] for m, v in _MK.items()}
CURRENCY_SYMBOL = {m: v.get("currency_symbol") or v["currency"] for m, v in _MK.items()}
STATUS   = {m: v.get("status", "dang_ban") for m, v in _MK.items()}
ACTIVE_MARKETS = [m for m in _MK if STATUS[m] == "dang_ban"]
# "da_tat" (04/11/2026): ngừng kéo số mới nhưng GIỮ tỷ giá, số chia — vẫn nằm trong ALLM để báo
# cáo những ngày nước đó còn chạy không đổi. Chỉ việc nhìn về phía trước (file tháng mới) bỏ nó.
DISABLED_MARKETS   = [m for m in _MK if STATUS[m] == "da_tat"]
# ── Ai cầm nước nào (Sỹ Anh chốt 10/10/2026) ──
# Số một người chạy LẤN sang nước của team khác (camp cũ chưa đổi tên: Lộc còn camp Đài + Sing,
# Thái còn camp Đài, Thương còn camp Sing) tính cho NGƯỜI CẦM nước đó. Thành viên team ở
# access.teams.*.members, người cầm ở markets.*.nguoi_cam. Người không thuộc team nào: giữ nguyên.
PERSON_MARKETS = {}
for _t in (RULES.get("access", {}).get("teams") or {}).values():
    if isinstance(_t, dict):
        for _nv in _t.get("members") or []:
            PERSON_MARKETS.setdefault(_nv, set()).update(_t.get("markets") or [])
MARKET_OWNER = {m: v["nguoi_cam"] for m, v in _MK.items() if v.get("nguoi_cam")}
# Người ĐÃ NGỪNG CHẠY (marketers.*.ngung_chay_tu, Sỹ Anh chốt 03/11/2026 — Thương từ 01/10/2026):
# từ ngày đó mọi số mang tên họ (tag POS khi họ tạo đơn với vai sale, camp cũ) về người cầm nước.
INACTIVE_SINCE = {k: v["ngung_chay_tu"] for k, v in RULES["marketers"].items()
              if isinstance(v, dict) and v.get("ngung_chay_tu")}


def credited_marketer(nv, mkt, date=None):
    """Người được tính số của ô (nv, nước, ngày 'YYYY-MM-DD'): chạy lấn nước của team khác, hoặc
    đã ngừng chạy tính tới ngày đó → người cầm nước đó. Không truyền ngày = số hiện tại."""
    since = INACTIVE_SINCE.get(nv)
    if since and (date is None or str(date)[:10] >= since):
        return MARKET_OWNER.get(mkt) or nv
    market = PERSON_MARKETS.get(nv)
    if market is None or mkt in market:
        return nv
    return MARKET_OWNER.get(mkt) or nv


# Nước lấy số TIN NHẮN từ Pancake thay Meta (Nhật — Meta không báo mess ở Nhật, 09/10/2026).
MESS_PANCAKE = {m for m, v in _MK.items() if v.get("mess_source") == "pancake"}
# X13 — số chia đưa cod/phí thô của POS về ĐƠN VỊ TIỀN THẬT của shop. 6 shop GCC lưu
# minor units (cod=9900 ⇒ 99,00 SAR) nên 100; shop Đài lưu NGUYÊN TWD (cod=950 ⇒
# 950 TWD) nên 1. Trước 20/08 mọi chỗ gõ thẳng "/100" ⇒ tiền Đài tụt 100 lần trên cả
# Sheet lẫn dashboard. Dùng MONEY_DIV[market] / MONEY_DIV_SHOP[shop_label], ĐỪNG gõ 100.
MONEY_DIV      = {m: _positive_or(v.get("pos_money_divisor"), 1) for m, v in _MK.items()}
MONEY_DIV_SHOP = {v["shop_label"]: _positive_or(v.get("pos_money_divisor"), 1) for m, v in _MK.items()}
ALLM     = list(_MK.keys())
# Nước dành cho campaign KHÔNG ghi nước ở tên (tên cũ). Sỹ Anh chốt 15/09/2026: tên cũ
# vẫn tính Đài, nhưng báo cáo liệt kê ra để sửa — xem campaign_market().
PRIMARY_MARKET = RULES.get("primary_market") or (ALLM[0] if ALLM else None)
MARKETS  = {tok: RULES["market_aliases"][tok] for tok in RULES["camp_market_tokens"]}
SHOP2MKT = {v["shop_label"]: m for m, v in _MK.items()}

def campaign_market(cn):
    """Tên campaign → (nước, nguồn). Nguồn: 'o_dau' (ô đầu là nước — đúng chuẩn),
    'o_khac' (nước nằm ô khác, tên kiểu cũ 'Tặng/TW/…'), 'mac_dinh' (không ghi nước →
    PRIMARY_MARKET). Cùng luật với parseCampaign/campaignMarketSource bên rules.ts."""
    p = [x.strip() for x in (cn or "").split("/")]
    for i, s in enumerate(p):
        m = MARKETS.get(s.upper())
        if m:
            return m, ("o_dau" if i == 0 else "o_khac")
    return PRIMARY_MARKET, "mac_dinh"

GTC_CAT = RULES["status"]["gtc_category"]
POS_TZ  = RULES["pos_timezone"]
NUMID   = re.compile(RULES["page_id_pattern"])

_CAMP_TOKENS = {k: v for k, v in RULES["camp_marketer_tokens"].items() if not k.startswith("_")}
_POS_RULES   = RULES["pos_marketer_rules"]
_SCAN_RULES  = RULES["camp_scan_rules"]
DISPLAY      = {k: v["display"] for k, v in RULES["marketers"].items()}

def norm_nv(s):
    """Segment campaign NGAY SAU thị trường → key marketer (exact-token, giống format_all cũ)."""
    if not s:
        return None
    u = s.strip().upper().replace(".", "").replace(" ", "")
    return _CAMP_TOKENS.get(u)

def norm_pos_nv(name):
    """Tên marketer tag trong POS ($.name) → key marketer; None = ngoài team."""
    if not name:
        return None
    u = str(name).upper()
    for r in _POS_RULES:
        if r["contains"] in u:
            return r["key"]
    return None

# ═══ NGƯỜI NGOÀI TEAM — chạy chung 14 TKQC + chung shop POS ═══
# Tách bạch chứ không gộp vào "(không gán)": chi phí của họ là tiền THẬT đi ra từ TKQC
# của TALPHA. Luôn tra bảng TEAM trước, trượt mới tra bảng này.
EXTERNAL          = RULES.get("external_marketers", {})
EXTERNAL_DISPLAY  = {k: v["display"] for k, v in EXTERNAL.items()}
EXTERNAL_FULL     = {k: v["full"] for k, v in EXTERNAL.items()}
_EXT_CAMP_TOKENS  = {k: v for k, v in RULES.get("camp_external_tokens", {}).items()
                     if not k.startswith("_")}
_EXT_POS_RULES    = RULES.get("pos_external_rules", [])

def norm_nv_external(s):
    """Segment ngay sau thị trường → key NGOÀI TEAM. Cùng cơ chế VỊ TRÍ với norm_nv —
    KHÔNG quét cả tên, vì 'kính lấp lánh'/'KÍNH UV'/'việt quẩt đen' là TÊN SẢN PHẨM."""
    if not s:
        return None
    u = s.strip().upper().replace(".", "").replace(" ", "")
    return _EXT_CAMP_TOKENS.get(u)

def norm_pos_external(name):
    """Tên tag POS → key NGOÀI TEAM (chỉ gọi khi norm_pos_nv trả None)."""
    if not name:
        return None
    u = str(name).upper()
    for r in _EXT_POS_RULES:
        if r["contains"] in u:
            return r["key"]
    return None

def parse_campaign_any(cn):
    """(thị trường, key, la_ngoai_team) — như parse_campaign nhưng nhận cả người ngoài team."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is None:
        return None, None, False
    mkt = MARKETS[p[mi].upper()]
    seg = p[mi + 1] if mi + 1 < len(p) else None
    team = norm_nv(seg)
    if team:
        return mkt, team, False
    ext = norm_nv_external(seg)
    return mkt, ext, bool(ext)

def _has_word_token(u, tok):
    return re.search(r"(^|[^A-Z])" + re.escape(tok) + r"([^A-Z]|$)", u) is not None

def scan_campaign_marketer(name):
    """Quét CẢ TÊN campaign → key marketer (dùng cho cảnh báo/bot, không cần parse segment)."""
    u = str(name or "").upper()
    for r in _SCAN_RULES:
        for s in r.get("substrings", []):
            if s in u:
                return r["key"]
        for t in r.get("word_tokens", []):
            if _has_word_token(u, t):
                return r["key"]
        rx = r.get("regex")
        if rx and re.search(rx, u):
            return r["key"]
    return None

_TESTRE = re.compile(RULES["test_campaign"]["pattern"])
_NO_TEST = set(RULES["test_campaign"]["exempt_markets"])
NO_TEST_MARKETS = _NO_TEST  # alias public (format_all dùng trực tiếp)

def is_test(cn, mkt=None):
    if mkt in _NO_TEST:
        return False
    return bool(_TESTRE.search(cn or ""))

# ── Phí ship 3PL (tệ địa phương, key = shop_label) ──
SHIP_FEES = RULES.get("shipping_fees", {})

def shipping_vnd(shop_label, orders, revenue_local):
    """Phí ship ước tính (VND) cho 1 thị trường, từ số đơn GTC + doanh thu tệ địa phương.
    KHÔNG dùng sale_order.shipping_fee (cột này mirror cod, rác). Thị trường chưa khai phí → 0."""
    f = SHIP_FEES.get((shop_label or "").upper())
    if not f or not orders or orders <= 0:
        return 0.0
    local = orders * (f["packing"] + f["delivery"] + f.get("cod_flat", 0)) + (revenue_local or 0) * f.get("cod_pct", 0)
    mkt = SHOP2MKT.get((shop_label or "").upper())
    return local * RATE.get(mkt, 0)

# ── Giá vốn theo SKU (E2) — VND/unit, key = product_catalog.sku ──
# POS không trả giá vốn (variation_info.last_imported_price/avg_price = 0 mọi item)
# → khối products trong JSON là nguồn DUY NHẤT. Song song với PRODUCT_COSTS bên rules.ts.
# Giá vốn khai bằng TỆ từ 08/09/2026 → VND = tệ × cost_rate_rmb_vnd. Bỏ qua cost_price_vnd cũ
# (giá hệ thống GCC, cao gấp mấy lần giá thật) — cùng luật với PRODUCT_COSTS bên rules.ts.
COST_RATE_RMB_VND = RULES.get("cost_rate_rmb_vnd") or 3860
PRODUCT_COSTS = {
    k: dict(v, cost_price_vnd=round(v["cost_price_rmb"] * COST_RATE_RMB_VND))
    for k, v in RULES.get("products", {}).items()
    if not k.startswith("_") and isinstance(v, dict) and isinstance(v.get("cost_price_rmb"), (int, float)) and v["cost_price_rmb"] > 0
}

def cost_price_vnd(sku):
    """Giá vốn 1 unit theo SKU (VND); None = SKU chưa khai giá vốn — KHÔNG coi là 0."""
    e = PRODUCT_COSTS.get(str(sku or "").strip())
    return e["cost_price_vnd"] if e else None

# ═══ GÁN MARKETER — RULE CEO 3 BẬC: parse_campaign · build_adid_owner · attribute_order ở order_rules.py
# Đơn không gán được KHÔNG bị bỏ lặng lẽ — luôn rơi vào "(không gán)" để còn thấy trên báo cáo.
UNASSIGNED = "(không gán)"

# ═══ NGƯỜI ĐÃ NGHỈ — dồn hết về "(không gán)" (khối unassign_marketers trong JSON) ═══
# CỐ Ý vẫn nhận diện được tên POS và campaign của họ: xoá khỏi pos_marketer_rules /
# camp_marketer_tokens thì campaign của họ không parse ra marketer nữa và spend rơi vào
# DROPPED — biến mất im lặng khỏi mọi báo cáo (đúng lỗi 20/08 đã phải đi vá). Ở đây chỉ
# đổi Ô ĐÍCH: nhận ra là của Mai/Thế → ném vào "(không gán)" cho CEO lọc tay sau.
UNASSIGN = set(RULES.get("unassign_marketers", []))

def bucket_nv(nv):
    """Key marketer → key ô báo cáo. Người đã nghỉ (UNASSIGN) → "(không gán)"."""
    return UNASSIGNED if nv in UNASSIGN else nv


# ═══ TÊN DỜI SANG MODULE RIÊNG (16/11/2026 — file vượt 300 dòng) ═══════════════════════════════
#   campaign_pages.py — sản phẩm / page của camp, nối đơn → camp theo nguồn đơn, tên tab theo page;
#   order_rules.py    — gán đơn → marketer 3 bậc, đơn trống.
# Hai module đó đọc luật ĐÃ NẠP ở trên (MARKETS, norm_nv…) nên không nhập lại ở đầu file được (vòng
# import). `from talpha_rules import parse_camp_product` vẫn chạy: Python hỏi __getattr__ dưới đây
# (PEP 562), nó nạp module chứa tên đó lúc cần. Nạp luật lại (test phủ thị trường) vẫn ra luật mới
# cho mọi hằng ở trên; các hàm dời đi thì đọc bản talpha_rules chính (tên module "talpha_rules").
_MOVED = {
    **dict.fromkeys(("parse_camp_product", "normalize_page_name", "build_page_index", "find_campaign_by_page",
                     "camp_page_cells", "build_page_tab_names", "order_tab_name"), "campaign_pages"),
    **dict.fromkeys(("parse_campaign", "build_adid_owner", "attribute_order",
                     "is_empty_order", "sql_is_empty_order"), "order_rules"),
}


def __getattr__(name: str):
    """Tên đã dời sang campaign_pages.py / order_rules.py → lấy từ đó (nạp lười, xem trên)."""
    module = _MOVED.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:   # module dời đi nằm cạnh file này (repo lẫn bản chép runtime)
        sys.path.insert(0, here)
    return getattr(importlib.import_module(module), name)
