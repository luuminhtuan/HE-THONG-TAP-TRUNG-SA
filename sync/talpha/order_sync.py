"""
Kéo đơn POS (Poscake) của mọi shop → Postgres (sale_order / order_items qua pg_writer).

Tách khỏi talpha_sync.py (16/11/2026) — code chuyển nguyên văn; talpha_sync nhập lại
sync_all_orders nên sync_month.py (`ts.sync_all_orders`) chạy như cũ. Ghi bằng append vào
<bảng>_raw rồi dựng lại bảng sạch trong MỘT transaction (pg_writer.write_orders) — kéo hụt không
xoá được dữ liệu đã có.
"""
import time
from datetime import datetime, timedelta

from sync.core import pg_writer
from sync.core.business_rules import convert_order_currency
from sync.core.pos_client import PoscakeClient, PosFetchError
from sync.talpha.sync_runtime import POS_SHOPS, _pg, log, sync_time


# ═══════════════════════════════════════════════════════════════════
# ORDER SYNC
# ═══════════════════════════════════════════════════════════════════


def _drop_foreign_currency(orders, items, shop):
    """Đưa đơn KHÁC LOẠI TIỀN về loại tiền của shop, không quy đổi được thì bỏ.

    Mọi con số tiền của đơn đều bị nhân với tỷ giá shop (800) vì tin rằng đầu vào
    là TWD. Một đơn 730.000 VND lọt qua nguyên như vậy hoá thành 584 TRIỆU VND doanh
    thu mà không có dấu hiệu nào báo sai — nên phải xử lý ngay ở cửa vào.

    Trước 14/09/2026 hàm này BỎ hết đơn VND. Với shop "TAIWAN SỸ ANH" thì bỏ là mất
    340 đơn, trong đó có toàn bộ đơn 01–10/09 — tuần đầu tháng báo cáo ra 0 đơn.
    Nay đơn VND được chia cho tỷ giá (xem business_rules.convert_order_currency); chỉ
    loại tiền không có tỷ giá mới bị bỏ, và luôn ghi rõ số đơn, không bỏ im lặng.
    """
    want = (shop.get("currency") or "").upper()
    if not want:
        return orders, items

    items_of: dict[str, list] = {}
    for it in items:
        items_of.setdefault(str(it.get("order_id", "")), []).append(it)

    keep, kept_items, converted, dropped = [], [], {}, {}
    divisor = shop.get("pos_money_divisor") or 1
    unmeasured = []
    for o in orders:
        cur = (o.get("order_currency") or want).upper()
        if cur == want and not shop.get("divisor_confirmed", True) and float(o.get("cod") or 0) > 0:
            unmeasured.append(o)
        conversion = convert_order_currency(o, items_of.get(str(o.get("id", "")), []), want, shop.get("rate_vnd"), divisor)
        if conversion is None:
            dropped[cur] = dropped.get(cur, 0) + 1
            continue
        keep.append(conversion[0])
        kept_items.extend(conversion[1])
        if cur != want:
            converted[cur] = converted.get(cur, 0) + 1

    if converted:
        log.info(
            f"  {shop['label']}: quy đổi {sum(converted.values())} đơn {converted} sang {want} "
            f"theo tỷ giá {shop.get('rate_vnd')} — doanh thu VND giữ đúng số gốc."
        )
    if dropped:
        log.warning(
            f"  {shop['label']}: bỏ {sum(dropped.values())} đơn khác loại tiền {dropped} "
            f"— không có tỷ giá để quy về {want}. Cộng vào là sai doanh thu."
        )
    if unmeasured:
        o = unmeasured[0]
        log.warning(
            f"  ⚠️ {shop['label']}: {len(unmeasured)} đơn ghi {want} có tiền nhưng số chia {divisor} CHƯA ĐO — "
            f"mở đơn id={o.get('id')} (cod={o.get('cod')}) trên POS so với giá bán, rồi đặt "
            f"pos_money_divisor_confirmed=true trong talpha_rules.json."
        )
    return keep, kept_items


def _shop_cutoff(window_start, orders_from):
    """Mốc inserted_at (UTC, dạng POS trả về) muộn hơn giữa cửa sổ sync và ngày bắt đầu tính
    đơn của shop. orders_from là NGÀY GIỜ VIỆT NAM — 00:00 giờ VN là 17:00 UTC hôm trước."""
    if not orders_from:
        return window_start
    cutoff = (datetime.strptime(orders_from, "%Y-%m-%d") - timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M:%S")
    return cutoff if not window_start or cutoff > window_start else window_start


def sync_all_orders(window_start=None) -> tuple[int, int]:
    """Fetch đơn TẠO từ `window_start` trở đi ở mọi POS shop rồi ghi vào Postgres.

    X1 — hai thay đổi so với bản cũ:
      • Cửa sổ theo `inserted_at` (đúng chiều sắp xếp của feed) thay cho Smart Stop
        theo `updated_at` — bản cũ dừng sớm ngẫu nhiên và cắt mất đơn thật.
      • Ghi bằng append vào <bảng>_raw rồi dựng lại bảng sạch, thay WRITE_TRUNCATE —
        kéo hụt không còn xoá được dữ liệu đã có.
    """
    all_orders, all_items = [], []
    seen_by_shop = {}   # shop kéo ĐỦ → (mốc, {id POS trả}) — để nhận ra đơn đã bị xoá trên POS

    failed_shops = []
    for shop in POS_SHOPS:
        if not shop.get("fetch_orders", True):
            # Nước đã tắt / sắp chạy: không kéo đơn mới. Shop vẫn nằm trong POS_SHOPS để bước dựng
            # lại bên dưới giữ đơn cũ của nó (xem pos_shops_from_markets trong business_rules).
            reason = "đã tắt — không kéo đơn mới, giữ đơn cũ" if shop.get("status") == "disabled" else "sắp chạy — chưa kéo đơn"
            log.info(f"  {shop['label']}: nước {reason}")
            continue
        if not shop["key"]:
            log.warning(f"  Skipping {shop['label']} — no API key")
            continue
        pos = PoscakeClient(
            api_key=shop["key"],
            shop_label=shop["label"],
            shop_id=shop.get("shop_id", ""),
            currency=shop.get("currency", "AED"),
            sync_time=sync_time,
        )
        # Mốc riêng của shop: đơn TẠO trước ngày orders_from (giờ VN) không kéo về.
        fetch_from = _shop_cutoff(window_start, shop.get("orders_from"))
        if fetch_from != window_start:
            log.info(f"  {shop['label']}: chỉ kéo đơn tạo từ {shop.get('orders_from')} (giờ VN) — {fetch_from} UTC")
        # Retry cả shop (ngoài retry từng page) — SA hay bị reset giữa chừng.
        orders = items = None
        for attempt in range(3):
            try:
                orders, items = pos.fetch_orders(window_start=fetch_from)
                break
            except PosFetchError as e:
                log.error(f"  {shop['label']} fetch lỗi (lần {attempt+1}/3): {e}")
                if attempt < 2:
                    time.sleep(30)
        if orders is None:
            failed_shops.append(shop["label"])
            continue

        # Lấy TRƯỚC khi lọc ngoại tệ: "POS còn trả" là đơn còn tồn tại, không phải đơn được tính.
        seen_by_shop[str(shop.get("shop_id") or pos.shop_id)] = (fetch_from or "", {str(o.get("id")) for o in orders})
        orders, items = _drop_foreign_currency(orders, items, shop)
        all_orders.extend(orders)
        all_items.extend(items)

    if not all_orders and failed_shops:
        raise RuntimeError(f"sale_order sync HỦY: mọi shop fetch thất bại {failed_shops}")

    if all_orders:
        # Ghi được ngay cả khi thiếu shop: append không xoá gì, đơn của shop lỗi chỉ
        # giữ nguyên bản cũ. Khác hẳn WRITE_TRUNCATE — trước đây thiếu 1 shop là phải
        # huỷ cả vòng ghi, nếu không sẽ xoá trắng đơn của shop đó.
        # Bảng sạch CHỈ gồm shop đang khai trong config. Đổi shop (14/09/2026:
        # 408074608 → 1022091930) thì đơn shop cũ vẫn nằm trong *_raw, không xoá,
        # nhưng không lọt vào báo cáo để bị đếm chung với shop mới.
        # Gồm CẢ shop của nước đã tắt — lọc nó ra ở đây là đơn cũ của nước đó biến mất.
        n_orders, n_items = pg_writer.write_orders(
            _pg(), all_orders, all_items,
            shop_ids=[s["shop_id"] for s in POS_SHOPS], replaced=seen_by_shop)
    else:
        log.warning("  Không fetch được order từ bất kỳ shop nào!")
        n_orders = n_items = 0

    # Vẫn báo lỗi để exit code ≠ 0 → report_health bắn cảnh báo, nhưng dữ liệu đã an toàn.
    if failed_shops:
        raise RuntimeError(
            f"Đã ghi {n_orders} đơn nhưng shop {failed_shops} fetch thất bại — "
            f"đơn của shop đó đang giữ bản cũ. Chạy lại khi POS ổn."
        )
    return n_orders, n_items
