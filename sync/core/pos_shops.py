"""
sync/core/pos_shops.py — danh sách shop POS sinh từ config/talpha_rules.json → markets.

Tách khỏi business_rules.py (16/11/2026, file đó vượt 300 dòng); business_rules nhập lại tên cũ nên
`from sync.core.business_rules import pos_shops_from_markets` vẫn chạy. Hàm thuần: chỉ đọc dict
markets (đã phủ thị trường nhập ở /admin) + biến môi trường chứa key POS.
"""
import os


# ─── Nước không kéo đơn: đã tắt, sắp chạy (04/11/2026) ───────────────────────
# CHỈ nước "active" được kéo đơn mới. "disabled" = ngừng kéo nhưng GIỮ tỷ giá, số chia và mọi đơn
# cũ; "upcoming" = có thể đã khai shop (thêm ở /admin → Thị trường) nhưng chưa bán.
# Shop không kéo VẪN ở trong danh sách, chỉ mang cờ fetch_orders=False: mỗi vòng sync dựng lại bảng đơn
# sạch CHỈ từ những shop có trong danh sách (bq_writer._loc_shop) — bỏ shop khỏi danh sách là đơn
# cũ của nước đó biến khỏi báo cáo ngay vòng sau.


def pos_shops_from_markets(markets: dict, env=None) -> list[dict]:
    """Danh sách shop POS từ config/talpha_rules.json → markets.

    Nước "sắp chạy" chưa có shop POS: bỏ qua, KHÔNG đưa vào danh sách. Để shop_id rỗng lọt vào
    là bộ lọc shop_ids của bảng đơn coi như "không lọc" — đơn shop Đài cũ 408074608 quay lại báo
    cáo. `or ""`: shop_id khai null (JSON) thì str(None) ra chữ "None" — lọt qua đây rồi làm bộ
    lọc shop_ids nổ "shop_id phải là dãy số", hỏng cả vòng sync (08/10/2026, Nhật mở khi chưa có
    shop: Sheet đứng từ 13:20).

    Nước đã tắt / sắp chạy có shop VẪN có mặt, mang `fetch_orders=False` — xem ghi chú trên.
    """
    env = os.environ if env is None else env
    out = []
    for market_name, m in (markets or {}).items():
        if not isinstance(m, dict):
            continue
        label = m.get("shop_label", "")
        if not label:
            continue
        sid = str(m.get("shop_id") or "").strip()
        if not sid:
            print(f"[pos] {market_name} ({label}): chưa có shop POS — chưa kéo đơn")
            continue
        out.append({
            "key": env.get(f"TALPHA_POSCAKE_{label}_KEY", ""),
            "label": label,
            "shop_id": sid,
            "currency": m.get("currency", ""),
            # Để quy đơn VND về tiền của shop — xem _drop_foreign_currency.
            "rate_vnd": m.get("rate_vnd"),
            "pos_money_divisor": m.get("pos_money_divisor") or 1,
            "divisor_confirmed": m.get("pos_money_divisor_confirmed", True),
            # Mốc NGÀY TẠO đơn (giờ VN) bắt đầu tính. Singapore có 54 đơn là bản sao đơn
            # Đài được tạo sẵn trước khi mở — kéo về là đơn Đài bị đếm hai lần.
            "orders_from": m.get("orders_from"),
            "status": m.get("status") or "active",
            "fetch_orders": (m.get("status") or "active") == "active",
        })
    return out
