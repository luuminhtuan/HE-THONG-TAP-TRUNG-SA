"""
Luật về ĐƠN: gán đơn → marketer theo rule CEO 3 bậc, và đơn trống không tính vào số đơn.

Tách khỏi talpha_rules.py (16/11/2026, file đó vượt 300 dòng) — thân hàm chuyển nguyên văn. Các hàm
gán đơn đọc luật ĐÃ NẠP của talpha_rules (MARKETS, norm_nv, norm_pos_nv, UNASSIGN, UNASSIGNED) nên
nhập từ đó; ngược lại talpha_rules trả các tên dưới đây qua __getattr__ (nạp lười). Máy chủ chạy
bản chép phẳng: deploy_runtime.sh chép kèm file này.
"""
from talpha_rules import MARKETS, UNASSIGN, UNASSIGNED, norm_nv, norm_pos_nv

# ═══════════════════════════════════════════════════════════════════
# GÁN MARKETER — RULE CEO 3 BẬC (nguồn duy nhất, mọi consumer gọi hàm này)
#   1. Tag marketer trong POS  →  2. ad_id → chủ campaign  →  3. "(không gán)"
# Đơn không gán được KHÔNG bị bỏ lặng lẽ — luôn rơi vào bậc 3 để còn thấy trên báo cáo.
# ═══════════════════════════════════════════════════════════════════
# (UNASSIGNED, UNASSIGN, bucket_nv nằm ở talpha_rules.py — format_all dùng thẳng.)


def parse_campaign(cn):
    """campaign_name → (thị trường, key marketer). Quy ước tên: '… / <Thị trường> / <Marketer> / …'
    — tìm ô ĐẦU TIÊN là tên thị trường (bỏ qua tiền tố Tặng//LADI/), marketer là ô ngay SAU."""
    p = [x.strip() for x in (cn or "").split("/")]
    mi = next((i for i, s in enumerate(p) if s.upper() in MARKETS), None)
    if mi is None:
        return None, None
    return MARKETS[p[mi].upper()], (norm_nv(p[mi + 1]) if mi + 1 < len(p) else None)


def build_adid_owner(rows):
    """[(ad_id, campaign_name), …] → {ad_id: key marketer} — bảng tra cho BẬC 2."""
    out = {}
    for ad_id, cn in rows:
        if not ad_id:
            continue
        _mkt, nv = parse_campaign(cn)
        # Người đã nghỉ KHÔNG vào bảng tra: bậc 2 mà trả về họ thì đơn không tag lại
        # chui ngược vào ô của họ, đúng thứ vừa bỏ đi.
        if nv and nv not in UNASSIGN:
            out[str(ad_id)] = nv
    return out


def attribute_order(pos_marketer=None, ad_id=None, adid_owner=None):
    """Gán 1 đơn về marketer theo rule CEO. Trả (key, nguồn):
       ('Loc', 'pos_tag') | ('Loc', 'ad_id') | ('(không gán)', 'unassigned')."""
    nv = norm_pos_nv(pos_marketer)
    if nv:
        # Đã nghỉ → "(không gán)" NGAY, không rơi xuống bậc 2: tag POS là bằng chứng
        # đơn này của họ, để fallback ad_id đẩy sang người khác là gán sai người.
        return (UNASSIGNED, "unassigned") if nv in UNASSIGN else (nv, "pos_tag")
    if ad_id and adid_owner:
        nv = adid_owner.get(str(ad_id))
        if nv:
            return nv, "ad_id"
    return UNASSIGNED, "unassigned"


# ═══ ĐƠN TRỐNG — KHÔNG TÍNH VÀO SỐ ĐƠN (Sỹ Anh chốt 17/09/2026) ═══════════════════════════════
# Đơn không có sản phẩm nào VÀ tổng tiền = 0 VÀ cod = 0. Tháng 9 shop Đài: đơn có tag marketer trên
# POS đều có tiền, đơn KHÔNG tag đều là đơn trống (Lộc 16 đơn thật + 45 đơn trống; Thương 11 + 19;
# Thái 2 + 18; Thắng 1 + 4). Đếm cả vào là số đơn thổi lên ~4 lần, CPO và tỷ lệ chốt đẹp giả —
# ngày 15/09 Lộc ra 3 đơn trong khi POS 2 (đơn #381 trống, không tag, gán theo page).
# Đơn được điền sản phẩm sau đó thì vòng sync kế tiếp tự tính lại. Doanh thu không đổi (đơn trống 0 đồng).
def is_empty_order(total_quantity, total_price, cod):
    """True khi đơn không sản phẩm, tổng tiền 0, cod 0. Ô trống/None coi như 0."""
    def to_number(x):
        s = str(x).strip() if x is not None else ""
        try:
            return float(s) if s and s.lower() != "none" else 0.0
        except ValueError:
            return None
    q, p, c = to_number(total_quantity), to_number(total_price), to_number(cod)
    return q == 0 and p == 0 and c == 0


def sql_is_empty_order(table=""):
    """Cùng điều kiện la_don_trong, viết bằng SQL Postgres cho bảng sale_order (total_quantity là
    chuỗi: không phải số thì coi như 0, đừng để ép kiểu làm chết cả câu)."""
    t = f"{table}." if table else ""
    return (f"(COALESCE(CASE WHEN btrim({t}total_quantity) ~ '^-?[0-9]+(\\.[0-9]+)?$' "
            f"THEN btrim({t}total_quantity)::float8 END, 0) = 0 "
            f"AND COALESCE({t}total_price, 0) = 0 AND COALESCE({t}cod, 0) = 0)")
