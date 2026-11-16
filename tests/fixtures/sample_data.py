"""
Dữ liệu MẪU cho Postgres trên máy thử — hình dạng như thật (4 nước, đơn có ad_id nối về quảng cáo,
dòng hàng nối danh mục SP, đủ các trạng thái) để chạy thử dashboard, view và báo cáo khi chưa nhập
khoá Meta / POS. KHÔNG phải số thật.

  DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha python3 tests/fixtures/sample_data.py
  (hoặc: docker compose run --rm --entrypoint python migrate tests/fixtures/sample_data.py)

Chỉ ghi vào database đang trống đơn — có đơn rồi (đã kéo số thật) thì dừng, không trộn số giả vào.
Ghi qua đúng đường sync ghi (pg_writer), nên bảng _raw / bảng sạch y như sau một vòng sync.
"""
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sync.core import pg_writer  # noqa: E402
from sync.core.pg import run_migrations, get_connection  # noqa: E402
from sync.core.pg_view import rebuild_views  # noqa: E402

RNG = random.Random(20261104)
SHOP = {   # nhãn → (shop_id, tiền, số chia, giá bán thô tiêu biểu)
    "TW": ("1022091930", "TWD", 1, (690, 1590)),
    "SG": ("715135541", "SGD", 100, (3900, 8900)),
    "AE": ("101090498", "AED", 100, (9900, 19900)),
    "JP": ("1022115860", "JPY", 1, (3900, 8900)),
}
PEOPLE = {"TW": ["LỘC", "THƯƠNG"], "SG": ["THÁI", "LỘC"], "AE": ["LỘC"], "JP": ["SỸ ANH"]}
POS_NAMES = {"LỘC": "Lộc", "THƯƠNG": "Thương", "THÁI": "Thái", "SỸ ANH": "Sỹ Anh"}
AD_ACCOUNTS = ["256210853826298", "9429066663871702"]
SKU = ["002", "004", "008", "012", "015"]
STATUSES = [("delivered", "GIAO_THANH_CONG", 45), ("received_money", "GIAO_THANH_CONG", 10),
              ("shipped", "DANG_GIAO", 15), ("returned", "DON_HOAN", 8), ("canceled", "HUY", 7),
              ("new", "DON_THO", 5), ("submitted", "DA_XAC_NHAN", 10)]


def _pick_status():
    x = RNG.uniform(0, sum(t[2] for t in STATUSES))
    for status, category, w in STATUSES:
        x -= w
        if x <= 0:
            return status, category
    return STATUSES[0][:2]


def main():
    conn = get_connection()
    run_migrations(conn)
    if conn.execute("SELECT COUNT(*) FROM sale_order").fetchone()[0]:
        print("Đã có đơn trong database — không ghi dữ liệu mẫu (tránh trộn số giả với số thật).")
        return 1
    today = datetime.utcnow().date()
    sync_time = datetime.utcnow().isoformat()

    # Danh mục SP: mỗi nước một biến thể / SKU
    catalog = []
    variants = {}
    for label, (shop_id, *_r) in SHOP.items():
        for sku in SKU:
            vid = f"v-{label.lower()}-{sku}"
            variants[(label, sku)] = vid
            catalog.append({"variation_id": vid, "product_id": f"p-{sku}", "sku": sku,
                            "product_name": f"{sku} - Sản phẩm mẫu {sku}", "variation_name": "Mặc định",
                            "retail_price": 990.0, "cost": 0.0, "remain_quantity": RNG.randint(0, 80),
                            "shop_label": label, "image": ""})
    pg_writer.replace_table(conn, "product_catalog", catalog)

    # Quảng cáo: mỗi người × nước × sản phẩm một camp, mỗi camp 2 ad
    ads, camps = [], []
    ads_by_person = {}
    for label, people in PEOPLE.items():
        for person in people:
            for sku in SKU[:3]:
                camp = f"{label}/{person}/PHI/{sku}-BLACK/Page {POS_NAMES[person]} {label}/2810"
                if sku == "015":
                    camp += "/test"
                cid = str(abs(hash(camp)) % 10**15)
                camps.append({"campaign_id": cid, "campaign_name": camp, "status": "ACTIVE",
                              "effective_status": "ACTIVE", "daily_budget": 500000.0, "account_id": AD_ACCOUNTS[0],
                              "sync_time": sync_time})
                for k in range(2):
                    aid = f"1202{abs(hash(camp + str(k))) % 10**11:011d}"
                    ads_by_person.setdefault((label, person), []).append((aid, cid, camp))
                    for d in range(40):
                        day = today - timedelta(days=d)
                        spend = RNG.uniform(150000, 900000)
                        impressions = int(spend / 60)
                        ads.append({"ad_id": aid, "ad_name": f"ad {k}", "adset_id": aid[:-2] + "00",
                                    "adset_name": "adset", "campaign_id": cid, "campaign_name": camp,
                                    "account_id": AD_ACCOUNTS[k % 2], "account_name": f"TKQC {k}", "date": str(day),
                                    "spend": round(spend), "spend_usd": 0.0, "impressions": impressions,
                                    "clicks": int(impressions * 0.02), "reach": int(impressions * 0.7), "purchases": 0,
                                    "purchase_value": 0.0, "leads": 0.0,
                                    "messaging_conversations_started": RNG.randint(3, 25), "add_to_cart": 0,
                                    "cpm": 60000.0, "ctr": 2.0, "cpc": 3000.0, "frequency": 1.4,
                                    "project_id": "TALPHA", "sync_time": sync_time})
    pg_writer.write_ads(conn, ads, "fb_ads_all", "ad_id")
    adsets = {}
    for a in ads:
        k = (a["account_id"], a["adset_id"], a["date"])
        x = adsets.setdefault(k, {**{c: a[c] for c in ("adset_id", "adset_name", "campaign_id", "campaign_name",
                                                         "account_id", "account_name", "date", "project_id",
                                                         "sync_time")}, "spend": 0.0, "impressions": 0,
                                  "messaging_conversations_started": 0})
        x["spend"] += a["spend"]
        x["impressions"] += a["impressions"]
        x["messaging_conversations_started"] += a["messaging_conversations_started"]
    pg_writer.write_ads(conn, list(adsets.values()), "fb_adset_all", "adset_id")
    pg_writer.replace_table(conn, "fb_campaign_all", camps)

    # Đơn
    orders, item = [], []
    counters = {n: 1000 for n in SHOP}
    for d in range(40):
        day = today - timedelta(days=d)
        for label, (shop_id, currency, divisor, (lo, hi)) in SHOP.items():
            for _ in range(RNG.randint(4, 14)):
                counters[label] += 1
                person = RNG.choice(PEOPLE[label])
                aid, cid, camp = RNG.choice(ads_by_person[(label, person)])
                name, group = _pick_status()
                created_at = datetime.combine(day, datetime.min.time()) + timedelta(minutes=RNG.randint(0, 1439))
                cod = RNG.randint(lo, hi)
                page = f"Page {POS_NAMES[person]} {label}"
                o = {"id": str(counters[label]), "shop_id": shop_id, "shop_label": label, "status": name,
                     "status_name": name, "status_category": group, "status_sub": "",
                     "total_price": float(cod), "shipping_fee": float(divisor * 5), "cod": float(cod),
                     "total_discount": 0.0, "partner_fee": float(divisor * 3), "return_fee": 0.0, "surcharge": 0.0,
                     "money_to_collect": float(cod), "total_quantity": "1",
                     "marketer": '{"name": "%s"}' % person if RNG.random() > 0.1 else "",
                     "ad_id": aid, "adset_id": aid[:-2] + "00", "ads_source": "facebook", "page_id": "",
                     "p_utm_term": aid if RNG.random() > 0.3 else "", "order_currency": currency,
                     "customer_id": f"kh{RNG.randint(1, 400)}", "customer_name": "Khách mẫu",
                     "bill_full_name": "Khách mẫu", "bill_phone_number": f"09{RNG.randint(10**7, 10**8 - 1)}",
                     "shipping_address": "Địa chỉ mẫu", "shipping_province": "", "shipping_district": "",
                     "partner": "", "warehouse_id": "", "tracking_link": "",
                     "inserted_at": created_at.strftime("%Y-%m-%dT%H:%M:%S"),
                     "updated_at": (created_at + timedelta(hours=RNG.randint(1, 72))).strftime("%Y-%m-%dT%H:%M:%S"),
                     "note": "", "tags": "", "order_link": "", "sync_time": sync_time,
                     "page_name": page, "seller_name": "Sale mẫu"}
                orders.append(o)
                for k in range(RNG.choice([1, 1, 2])):
                    sku = RNG.choice(SKU)
                    item.append({"item_id": f"{counters[label]}-{k}", "order_id": str(counters[label]), "shop_id": shop_id,
                                 "shop_name": label, "project_id": "TALPHA", "product_id": f"p-{sku}",
                                 "variation_id": variants[(label, sku)], "product_name": f"{sku} - Sản phẩm mẫu",
                                 "variation_name": "Mặc định", "quantity": RNG.choice([1, 1, 2]),
                                 "return_quantity": 0, "retail_price": float(cod), "is_bonus_product": "False",
                                 "is_composite": "False", "is_wholesale": "False",
                                 "order_inserted_at": o["inserted_at"], "sync_time": sync_time})
    pg_writer.write_orders(conn, orders, item)
    rebuild_views(conn, force=True)
    print(f"Dữ liệu mẫu: {len(orders)} đơn · {len(item)} dòng hàng · {len(ads)} dòng quảng cáo · {len(catalog)} SP")
    return 0


if __name__ == "__main__":
    sys.exit(main())
