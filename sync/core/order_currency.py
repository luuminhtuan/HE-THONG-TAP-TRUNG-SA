"""
sync/core/order_currency.py — R2b: đưa đơn ghi bằng VND trong shop tiền khác về tiền của shop.

Tách khỏi business_rules.py (16/11/2026, file đó vượt 300 dòng); business_rules nhập lại tên cũ nên
`from sync.core.business_rules import convert_order_currency` vẫn chạy. Hàm thuần, không đọc luật.
"""
from typing import Optional

# ─── R2b: Đơn ghi bằng VND nằm trong shop TWD ───────────────────────────────
# Shop POS "TAIWAN SỸ ANH" (1022091930) giữ 340 đơn lịch sử ghi bằng VND bên cạnh đơn
# TWD — cả đơn đầu tháng 9. Mọi nơi đọc bảng đơn đều nhân `cod` với tỷ giá shop (800)
# vì tin đó là TWD. Để nguyên thì đơn 730.000đ hoá 584 TRIỆU doanh thu; bỏ đi thì mất
# luôn số đơn cả tuần đầu tháng. Nên quy về tiền của shop NGAY Ở CỬA VÀO: chia cho
# tỷ giá, để phép nhân phía sau trả lại đúng số VND ban đầu.
ORDER_MONEY_FIELDS = (
    "total_price", "shipping_fee", "cod", "total_discount", "partner_fee",
    "return_fee", "surcharge", "money_to_collect",
)
# Tiền BÁN trên từng dòng hàng, cùng loại tiền với đơn. Giá nhập (avg_imported_price)
# là dữ liệu sản phẩm của shop, không theo loại tiền của đơn — không đụng tới.
ITEM_MONEY_FIELDS = ("retail_price", "discount_each_product", "total_discount", "same_price_discount")


def convert_order_currency(order: dict, items: list[dict], shop_currency: str,
                         rate_vnd: Optional[float], divisor: int = 1) -> Optional[tuple[dict, list[dict]]]:
    """Đưa một đơn về loại tiền của shop. Trả (đơn, items) đã quy đổi, hoặc None nếu phải bỏ.

    - Đơn cùng loại tiền với shop (hoặc không ghi loại tiền): trả nguyên.
    - Đơn VND trong shop có tỷ giá VND: chia mọi khoản tiền cho tỷ giá rồi NHÂN số chia
      của shop, đổi nhãn sang tiền của shop. Phía sau lấy `cod ÷ số chia × tỷ giá` nên ra
      lại đúng số VND gốc — kể cả shop lưu tiền theo đơn vị nhỏ (Singapore: số chia 100).
    - Loại tiền khác, hoặc shop không có tỷ giá VND: None — không đoán tỷ giá.
    """
    want = (shop_currency or "").upper()
    cur = (order.get("order_currency") or want).upper()
    if not want or cur == want:
        return order, items
    if cur != "VND" or not rate_vnd or rate_vnd <= 0:
        return None
    new_order = dict(order)
    for k in ORDER_MONEY_FIELDS:
        if new_order.get(k) is not None:
            new_order[k] = round(float(new_order[k] or 0) / rate_vnd * (divisor or 1), 4)
    new_order["order_currency"] = want
    new_items = []
    for it in items:
        x = dict(it)
        for k in ITEM_MONEY_FIELDS:
            if x.get(k) is not None:
                x[k] = round(float(x[k] or 0) / rate_vnd * (divisor or 1), 4)
        new_items.append(x)
    return new_order, new_items
