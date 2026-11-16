"""
TALPHA Business Rules — 8 quy tắc nghiệp vụ bắt buộc.

Đây là source of truth cho mọi tính toán liên quan đến doanh thu, FX, marketer,
và ghép ads↔đơn. Sai 1 rule = số liệu sai toàn bộ.

Dùng trong:
  - sync/talpha/talpha_sync.py   (ETL side)
  - tests/test_talpha_business_rules.py (tests)
  - SQL queries trong dashboard đều phải khớp với logic ở đây
"""
import json
from typing import Optional

# Tách 16/11/2026 (file vượt 300 dòng) — nhập lại để tên cũ trong business_rules vẫn dùng được.
from sync.core.order_currency import ITEM_MONEY_FIELDS, ORDER_MONEY_FIELDS, convert_order_currency  # noqa: F401
from sync.core.pos_shops import pos_shops_from_markets  # noqa: F401

# ─── R2 · R1b · R3: Thị trường — ĐỌC TỪ config/talpha_rules.json → markets ──────
# Trước 15/09/2026 ba bảng dưới gõ cứng đúng một nước (TW). Mở thêm Singapore, UAE mà
# vẫn gõ tay ở đây là có hai nguồn tỷ giá — đổi JSON thì dashboard đổi, Python đứng yên.
# Nay sinh từ JSON; chỉ nước ĐÃ có số mới vào bảng (nước "upcoming" có tỷ giá null thì
# không có dòng — to_vnd() với nước đó ném lỗi thay vì âm thầm nhân sai).
#
# X13 — số chia là số đơn vị phụ trên 1 đơn vị tiền MÀ POS ĐANG LƯU, không phải số thập
# phân ISO 4217. Shop Đài lưu NGUYÊN TWD (cod=950 ⇒ 950 TWD) → 1; shop GCC cũ lưu minor
# units (cod=9900 ⇒ 99,00 SAR) → 100. Trước 20/08 mọi nơi chia 100 ⇒ tiền Đài tụt 100 lần.
def _load_markets() -> dict:
    # Đã phủ thị trường nhập ở /admin → Thị trường (04/11/2026) — xem sync/core/market_config.py.
    from sync.core.market_config import load_rules
    return {k: v for k, v in (load_rules().get("markets") or {}).items() if isinstance(v, dict)}


def _is_positive(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


_MARKETS = _load_markets()

FX_RATES_TO_VND: dict[str, float] = {
    v["shop_label"]: v["rate_vnd"] for v in _MARKETS.values() if _is_positive(v.get("rate_vnd"))
}
FX_RATES_TO_VND["USD"] = 25700    # USD → VND (Meta ads billing)

# Key có trong FX_RATES_TO_VND nhưng KHÔNG phải shop_label của đơn (chỉ dùng cho
# tiền quảng cáo) → loại khỏi CASE shop_label khi sinh SQL.
_NON_SHOP_FX_KEYS: frozenset[str] = frozenset(["USD"])

POS_MONEY_DIVISOR: dict[str, int] = {
    v["shop_label"]: v["pos_money_divisor"] for v in _MARKETS.values() if _is_positive(v.get("pos_money_divisor"))
}
DEFAULT_MONEY_DIVISOR = 100  # shop mới chưa khai: giữ mặc định minor units

# Market code → tên chuẩn (MỌI nước khai trong JSON, kể cả nước sắp chạy)
MARKET_NAMES: dict[str, str] = {v["shop_label"]: market_name for market_name, v in _MARKETS.items()}


# ─── Nước không kéo đơn: đã tắt, sắp chạy — pos_shops_from_markets ở sync/core/pos_shops.py ──────

# Poscake status_name → (category, sub_category)
STATUS_CATEGORY_MAP: dict[str, tuple[str, str]] = {
    "delivered":      ("GIAO_THANH_CONG", "da_nhan"),
    "received_money": ("GIAO_THANH_CONG", "da_thu_tien"),
    "packing":        ("DANG_GIAO",       "dang_dong_hang"),
    "pending":        ("DANG_GIAO",       "cho_chuyen_hang"),
    "shipped":        ("DANG_GIAO",       "da_gui_hang"),
    "returning":      ("DON_HOAN",        "dang_hoan"),
    "returned":       ("DON_HOAN",        "da_hoan"),
    "canceled":       ("HUY",             "da_huy"),
    "new":            ("DON_THO",         "moi"),
    "submitted":      ("DA_XAC_NHAN",     "da_xac_nhan"),
    "waitting":       ("CHO_HANG",        "cho_hang"),
    "ordered":        ("DA_DAT_HANG",     "da_dat_hang"),
}

# Statuses counted as "successfully delivered" (dùng để filter doanh thu)
SUCCESS_STATUSES = frozenset(["GIAO_THANH_CONG"])


# ─── R1: Doanh thu ──────────────────────────────────────────────────────────

def money_divisor(shop_label: str) -> int:
    """R1b (X13): shop_label → số chia đưa tiền thô của POS về đơn vị tiền thật."""
    return POS_MONEY_DIVISOR.get((shop_label or "").upper(), DEFAULT_MONEY_DIVISOR)


def calc_revenue_local(cod_raw: float, shop_label: str) -> float:
    """R1: Doanh thu (tệ địa phương) = cod / số chia CỦA SHOP ĐÓ.
    GCC lưu minor units (cod=9900 ⇒ 99,00); Đài lưu nguyên TWD (cod=950 ⇒ 950).
    Chỉ áp dụng cho đơn có status_category = GIAO_THANH_CONG và cod > 0.
    `shop_label` là BẮT BUỘC — chia 100 cho mọi shop chính là lỗi X13.
    """
    return (cod_raw or 0) / money_divisor(shop_label)


def is_success_order(status_category: str, cod_raw: float) -> bool:
    """R1: Kiểm tra đơn có tính doanh thu không."""
    return status_category in SUCCESS_STATUSES and (cod_raw or 0) > 0


# ─── R2: FX Conversion ──────────────────────────────────────────────────────

def to_vnd(amount_local: float, shop_label: str) -> float:
    """R2: Quy đổi tiền địa phương → VND theo shop_label.
    shop_label: AE / SA / KW / OM / QA / BH
    """
    rate = FX_RATES_TO_VND.get(shop_label.upper(), 0)
    if rate == 0:
        raise ValueError(f"Unknown shop_label: {shop_label}. Valid: {list(FX_RATES_TO_VND)}")
    return round(amount_local * rate, 2)


def revenue_vnd(cod_raw: float, shop_label: str) -> float:
    """R1 + R2: Doanh thu VND = (cod / số chia của shop) × FX_rate."""
    return to_vnd(calc_revenue_local(cod_raw, shop_label), shop_label)


# ─── R2b: Đơn ghi bằng VND nằm trong shop TWD — convert_order_currency ở sync/core/order_currency.py ─


# ─── R3: Market ─────────────────────────────────────────────────────────────

def get_market_display(shop_label: str) -> str:
    """R3: shop_label → tên hiển thị (AE → UAE, SA → Saudi...)."""
    return MARKET_NAMES.get(shop_label.upper(), shop_label)


# ─── R4: Marketer ───────────────────────────────────────────────────────────

def extract_marketer_name(marketer_raw) -> Optional[str]:
    """R4: Trích tên marketer từ cột marketer.

    POS ghi cột này theo HAI dạng: chuỗi JSON '{"name":"Hồ Sỹ Anh","id":123}'
    khi có tag, và chuỗi thường 'Chu Thuý' khi nhập tay. Trước đây hàm này chỉ
    đọc JSON nên trả None cho dạng chuỗi thường, trong khi vw_orders_std lại
    COALESCE sang chuỗi thường — cùng một đơn ra hai kết quả khác nhau tuỳ ai hỏi.
    Trả None khi không có tên thật.
    """
    if not marketer_raw:
        return None
    s = marketer_raw if isinstance(marketer_raw, str) else str(marketer_raw)
    s = s.strip()
    if not s or s in ("null", "None", "Unknown", "{}"):
        return None
    if s.startswith("{"):
        try:
            name = (json.loads(s).get("name") or "").strip()
        except (json.JSONDecodeError, AttributeError):
            return None
    else:
        name = s
    return name if name and name.lower() != "unknown" else None


def is_valid_marketer(marketer_raw) -> bool:
    """R4: Kiểm tra đơn có marketer hợp lệ không."""
    return extract_marketer_name(marketer_raw) is not None


# ─── R5: Ads Spend ──────────────────────────────────────────────────────────

def validate_ads_spend(spend_vnd: float) -> float:
    """R5: Ads spend trong fb_ads_data.spend đã là VND.
    Không ÷100, không quy đổi thêm. Chỉ validate là số dương.
    """
    return max(0.0, float(spend_vnd or 0))


# ─── R6: Join ads↔đơn ───────────────────────────────────────────────────────

def normalize_ad_id_for_join(ad_id) -> str:
    """R6: Chuẩn hóa ad_id về STRING để join.
    fb_ads_data.ad_id là INT64, sale_order.ad_id là STRING.
    SQL: CAST(fb_ads_data.ad_id AS STRING) = sale_order.ad_id
    """
    if ad_id is None:
        return ""
    return str(int(float(ad_id))) if ad_id else ""


# ─── R7: ROAS & AOV ─────────────────────────────────────────────────────────

def calc_roas(revenue_vnd: float, spend_vnd: float) -> Optional[float]:
    """R7: ROAS = doanh thu VND ÷ ads spend VND."""
    if not spend_vnd or spend_vnd == 0:
        return None
    return round(revenue_vnd / spend_vnd, 2)


def calc_aov(revenue_vnd: float, order_count: int) -> Optional[float]:
    """R7: AOV = tổng doanh thu ÷ số đơn thành công."""
    if not order_count or order_count == 0:
        return None
    return round(revenue_vnd / order_count, 0)


# ─── R8: Timezone ───────────────────────────────────────────────────────────
# inserted_at từ Pancake là UTC. Cần convert sang timezone của từng thị trường.
# TKQC META thường dùng timezone của market khi báo cáo.
# Fix đã áp: string-slice bug ký tự 65 → 57 trong vw_orders_std.sql

# Giờ ĐỊA PHƯƠNG của nước — chỉ để tham khảo. Đơn gom theo ngày bằng pos_timezone (giờ
# Việt Nam) cho CẢ BA nước, Sỹ Anh chốt 15/09/2026: đội làm việc giờ Việt Nam.
MARKET_TIMEZONES: dict[str, str] = {
    "TW": "Asia/Taipei",     # UTC+8
    "SG": "Asia/Singapore",  # UTC+8
    "AE": "Asia/Dubai",      # UTC+4
}


def get_market_timezone(shop_label: str) -> str:
    """R8: Trả về timezone của market theo shop_label."""
    return MARKET_TIMEZONES.get(shop_label.upper(), "Asia/Taipei")


# ─── Status helpers ──────────────────────────────────────────────────────────


# ─── SQL snippets (dùng trong query builder) ─────────────────────────────────


