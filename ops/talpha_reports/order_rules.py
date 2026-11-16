"""
Luật về ĐƠN: đơn trống không tính vào số đơn.

Tách khỏi talpha_rules.py (16/11/2026, file đó vượt 300 dòng) — thân hàm chuyển nguyên văn; talpha_rules
trả các tên dưới đây qua __getattr__ (nạp lười). Máy chủ chạy bản chép phẳng: deploy_runtime.sh chép kèm.
12/11/2026 (main, Sỹ Anh dọn code thừa): bỏ parse_campaign / build_adid_owner / attribute_order — không còn ai
gọi; gán đơn → marketer 3 bậc nằm ở report_data.py (_add_orders).
"""


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
