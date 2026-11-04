"""
Dữ liệu MẪU cho Postgres trên máy thử — hình dạng như thật (4 nước, đơn có ad_id nối về quảng cáo,
dòng hàng nối danh mục SP, đủ các trạng thái) để chạy thử dashboard, view và báo cáo khi chưa nhập
khoá Meta / POS. KHÔNG phải số thật.

  DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha python3 tests/fixtures/du_lieu_mau.py
  (hoặc: docker compose run --rm --entrypoint python migrate tests/fixtures/du_lieu_mau.py)

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
from sync.core.pg import chay_migrations, ket_noi  # noqa: E402
from sync.core.pg_view import dung_view  # noqa: E402

NGAU = random.Random(20261104)
SHOP = {   # nhãn → (shop_id, tiền, số chia, giá bán thô tiêu biểu)
    "TW": ("1022091930", "TWD", 1, (690, 1590)),
    "SG": ("715135541", "SGD", 100, (3900, 8900)),
    "AE": ("101090498", "AED", 100, (9900, 19900)),
    "JP": ("1022115860", "JPY", 1, (3900, 8900)),
}
NGUOI = {"TW": ["LỘC", "THƯƠNG"], "SG": ["THÁI", "LỘC"], "AE": ["LỘC"], "JP": ["SỸ ANH"]}
TEN_POS = {"LỘC": "Lộc", "THƯƠNG": "Thương", "THÁI": "Thái", "SỸ ANH": "Sỹ Anh"}
TKQC = ["256210853826298", "9429066663871702"]
SKU = ["002", "004", "008", "012", "015"]
TRANG_THAI = [("delivered", "GIAO_THANH_CONG", 45), ("received_money", "GIAO_THANH_CONG", 10),
              ("shipped", "DANG_GIAO", 15), ("returned", "DON_HOAN", 8), ("canceled", "HUY", 7),
              ("new", "DON_THO", 5), ("submitted", "DA_XAC_NHAN", 10)]


def _chon_trang_thai():
    x = NGAU.uniform(0, sum(t[2] for t in TRANG_THAI))
    for ten, nhom, w in TRANG_THAI:
        x -= w
        if x <= 0:
            return ten, nhom
    return TRANG_THAI[0][:2]


def main():
    conn = ket_noi()
    chay_migrations(conn)
    if conn.execute("SELECT COUNT(*) FROM sale_order").fetchone()[0]:
        print("Đã có đơn trong database — không ghi dữ liệu mẫu (tránh trộn số giả với số thật).")
        return 1
    hom_nay = datetime.utcnow().date()
    sync_time = datetime.utcnow().isoformat()

    # Danh mục SP: mỗi nước một biến thể / SKU
    catalog = []
    bien_the = {}
    for nhan, (shop_id, *_r) in SHOP.items():
        for sku in SKU:
            vid = f"v-{nhan.lower()}-{sku}"
            bien_the[(nhan, sku)] = vid
            catalog.append({"variation_id": vid, "product_id": f"p-{sku}", "sku": sku,
                            "product_name": f"{sku} - Sản phẩm mẫu {sku}", "variation_name": "Mặc định",
                            "retail_price": 990.0, "cost": 0.0, "remain_quantity": NGAU.randint(0, 80),
                            "shop_label": nhan, "image": ""})
    pg_writer.thay_ca_bang(conn, "product_catalog", catalog)

    # Quảng cáo: mỗi người × nước × sản phẩm một camp, mỗi camp 2 ad
    ads, camps = [], []
    ad_cua = {}
    for nhan, nguoi in NGUOI.items():
        for ng in nguoi:
            for sku in SKU[:3]:
                camp = f"{nhan}/{ng}/PHI/{sku}-BLACK/Page {TEN_POS[ng]} {nhan}/2810"
                if sku == "015":
                    camp += "/test"
                cid = str(abs(hash(camp)) % 10**15)
                camps.append({"campaign_id": cid, "campaign_name": camp, "status": "ACTIVE",
                              "effective_status": "ACTIVE", "daily_budget": 500000.0, "account_id": TKQC[0],
                              "sync_time": sync_time})
                for k in range(2):
                    aid = f"1202{abs(hash(camp + str(k))) % 10**11:011d}"
                    ad_cua.setdefault((nhan, ng), []).append((aid, cid, camp))
                    for d in range(40):
                        ngay = hom_nay - timedelta(days=d)
                        tieu = NGAU.uniform(150000, 900000)
                        hien = int(tieu / 60)
                        ads.append({"ad_id": aid, "ad_name": f"ad {k}", "adset_id": aid[:-2] + "00",
                                    "adset_name": "adset", "campaign_id": cid, "campaign_name": camp,
                                    "account_id": TKQC[k % 2], "account_name": f"TKQC {k}", "date": str(ngay),
                                    "spend": round(tieu), "spend_usd": 0.0, "impressions": hien,
                                    "clicks": int(hien * 0.02), "reach": int(hien * 0.7), "purchases": 0,
                                    "purchase_value": 0.0, "leads": 0.0,
                                    "messaging_conversations_started": NGAU.randint(3, 25), "add_to_cart": 0,
                                    "cpm": 60000.0, "ctr": 2.0, "cpc": 3000.0, "frequency": 1.4,
                                    "project_id": "TALPHA", "sync_time": sync_time})
    pg_writer.ghi_ads(conn, ads, "fb_ads_data", "ad_id")
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
    pg_writer.ghi_ads(conn, list(adsets.values()), "fb_adset_data", "adset_id")
    pg_writer.thay_ca_bang(conn, "fb_campaign_data", camps)

    # Đơn
    don, item = [], []
    so = {n: 1000 for n in SHOP}
    for d in range(40):
        ngay = hom_nay - timedelta(days=d)
        for nhan, (shop_id, tien, chia, (lo, hi)) in SHOP.items():
            for _ in range(NGAU.randint(4, 14)):
                so[nhan] += 1
                ng = NGAU.choice(NGUOI[nhan])
                aid, cid, camp = NGAU.choice(ad_cua[(nhan, ng)])
                ten, nhom = _chon_trang_thai()
                gio = datetime.combine(ngay, datetime.min.time()) + timedelta(minutes=NGAU.randint(0, 1439))
                cod = NGAU.randint(lo, hi)
                trang = f"Page {TEN_POS[ng]} {nhan}"
                o = {"id": str(so[nhan]), "shop_id": shop_id, "shop_label": nhan, "status": ten,
                     "status_name": ten, "status_category": nhom, "status_sub": "",
                     "total_price": float(cod), "shipping_fee": float(chia * 5), "cod": float(cod),
                     "total_discount": 0.0, "partner_fee": float(chia * 3), "return_fee": 0.0, "surcharge": 0.0,
                     "money_to_collect": float(cod), "total_quantity": "1",
                     "marketer": '{"name": "%s"}' % ng if NGAU.random() > 0.1 else "",
                     "ad_id": aid, "adset_id": aid[:-2] + "00", "ads_source": "facebook", "page_id": "",
                     "p_utm_term": aid if NGAU.random() > 0.3 else "", "order_currency": tien,
                     "customer_id": f"kh{NGAU.randint(1, 400)}", "customer_name": "Khách mẫu",
                     "bill_full_name": "Khách mẫu", "bill_phone_number": f"09{NGAU.randint(10**7, 10**8 - 1)}",
                     "shipping_address": "Địa chỉ mẫu", "shipping_province": "", "shipping_district": "",
                     "partner": "", "warehouse_id": "", "tracking_link": "",
                     "inserted_at": gio.strftime("%Y-%m-%dT%H:%M:%S"),
                     "updated_at": (gio + timedelta(hours=NGAU.randint(1, 72))).strftime("%Y-%m-%dT%H:%M:%S"),
                     "note": "", "tags": "", "order_link": "", "sync_time": sync_time,
                     "page_name": trang, "seller_name": "Sale mẫu"}
                don.append(o)
                for k in range(NGAU.choice([1, 1, 2])):
                    sku = NGAU.choice(SKU)
                    item.append({"item_id": f"{so[nhan]}-{k}", "order_id": str(so[nhan]), "shop_id": shop_id,
                                 "shop_name": nhan, "project_id": "TALPHA", "product_id": f"p-{sku}",
                                 "variation_id": bien_the[(nhan, sku)], "product_name": f"{sku} - Sản phẩm mẫu",
                                 "variation_name": "Mặc định", "quantity": NGAU.choice([1, 1, 2]),
                                 "return_quantity": 0, "retail_price": float(cod), "is_bonus_product": "False",
                                 "is_composite": "False", "is_wholesale": "False",
                                 "order_inserted_at": o["inserted_at"], "sync_time": sync_time})
    pg_writer.ghi_don(conn, don, item)
    dung_view(conn, ep=True)
    print(f"Dữ liệu mẫu: {len(don)} đơn · {len(item)} dòng hàng · {len(ads)} dòng quảng cáo · {len(catalog)} SP")
    return 0


if __name__ == "__main__":
    sys.exit(main())
