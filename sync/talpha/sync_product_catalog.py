"""
sync/talpha/sync_product_catalog.py — Build product dimension từ Poscake POS.

order_items chỉ có product_id + variation_id (UUID) + quantity; KHÔNG có tên/giá.
Script này fetch products của mọi shop POS khai ở talpha_rules.json → markets (nước đã tắt: giữ
SP cũ, không gọi POS), dựng bảng `product_catalog`
(variation_id → product_id, sku, name, retail_price, cost) để JOIN với order_items.

Thay cả bảng `product_catalog` trong Postgres (dimension, full refresh, một transaction). View
`vw_product_pnl` nay nằm trong bộ view chung (db/views/12_vw_product_pnl.sql).

Usage:
  python sync/talpha/sync_product_catalog.py            # full sync
  python sync/talpha/sync_product_catalog.py --dry-run  # chỉ fetch, không ghi
"""
import os, sys, time, argparse
import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from sync.core import pg_writer  # noqa: E402
from sync.core.business_rules import shop_pos_tu_markets  # noqa: E402
from sync.core.pg import ket_noi  # noqa: E402
from sync.core.thi_truong import doc_luat  # noqa: E402

# Trên máy chủ khoá POS do systemd nạp (talpha-catalog.service đọc dashboard-ui/.env.local).
# Chạy tay ở máy dev thì đọc .env cạnh script hoặc theo cwd.
load_dotenv()
load_dotenv(os.path.join(os.getcwd(), ".env"))
# Key POS nhập ở /admin → Khoá kết nối (bảng api_credentials) thắng key cùng tên trong .env.
from sync.core.khoa import nap_khoa_vao_env  # noqa: E402
nap_khoa_vao_env()

POS_API = "https://pos.pages.fm/api/v1"
TABLE = "product_catalog"


def load_shops() -> list[dict]:
    """Shop POS — CÙNG danh sách với sync đơn: talpha_rules.json → markets đã phủ thị trường nhập ở
    /admin (shop_pos_tu_markets, 04/11/2026). Mỗi shop có label, shop_id, keo (chỉ nước đang bán
    mới gọi POS; nước đã tắt / sắp chạy thì giữ SP đang có).

    Danh sách shop CHỈ có 1 nguồn. Bản hardcode cũ thiếu Taiwan → 100% order_items của TW không
    khớp catalog (102/102 dòng, đo 04/08/2026) → mất hẳn TW khỏi mọi báo cáo theo sản phẩm. Sau đó
    đọc talpha.yaml kèm danh sách dự phòng gõ cứng 6 shop GCC đã chết — nay bỏ cả hai: đọc luật
    hỏng thì DỪNG, không chạy bằng danh sách sai."""
    return shop_pos_tu_markets(doc_luat().get("markets") or {})


SHOPS = load_shops()


def fetch_shop_products(label: str, shop_id: str, key: str) -> list[dict]:
    """Fetch toàn bộ products của 1 shop, trả về list variation rows."""
    rows, page = [], 1
    while True:
        try:
            r = requests.get(
                f"{POS_API}/shops/{shop_id}/products",
                params={"api_key": key, "page_number": page, "page_size": 100},
                timeout=30,
            )
            if r.status_code != 200:
                print(f"  [{label}] page {page} HTTP {r.status_code} — dừng")
                break
            d = r.json()
        except Exception as e:
            print(f"  [{label}] page {page} lỗi: {e}")
            break

        prods = d.get("data", [])
        if not prods:
            break

        for p in prods:
            pid = str(p.get("id", ""))
            sku = str(p.get("custom_id", "") or "")
            name = str(p.get("name", "") or "")
            for v in (p.get("variations", []) or []):
                rows.append({
                    "variation_id": str(v.get("id", "")),
                    "product_id":   pid,
                    "sku":          sku,
                    "product_name": name,
                    "variation_name": str(v.get("display_id", "") or ""),
                    "retail_price": float(v.get("retail_price", 0) or 0),
                    "cost":         float(v.get("last_imported_price", 0) or 0),
                    "remain_quantity": int(v.get("remain_quantity", 0) or 0),
                    "shop_label":   label,
                    "image":        (v.get("images") or [None])[0],
                })

        total_pages = d.get("total_pages", 1)
        print(f"  [{label}] page {page}/{total_pages}: +{len(prods)} products")
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Chỉ fetch, không ghi")
    ap.add_argument("--force", action="store_true",
                    help="Ghi đè kể cả khi bảng mới hụt >30%% so với bảng đang có "
                         "(chỉ dùng khi ĐÃ BIẾT vì sao hụt, VD POS thật sự xoá bớt SP)")
    args = ap.parse_args()

    # Chỉ nước đang bán gọi POS. Nước đã tắt (key có thể đã bỏ) / sắp chạy: SP đang có giữ nguyên, xem dưới.
    can_goi = [(s["label"], s["shop_id"]) for s in SHOPS if s["keo"]]
    missing = [lb for lb, _ in can_goi if not os.environ.get(f"TALPHA_POSCAKE_{lb}_KEY", "")]
    if can_goi and len(missing) == len(can_goi):
        # Không có key nào = chưa nạp được khoá. Chạy tiếp sẽ thay bảng bằng 0 dòng
        # và giết mọi báo cáo theo SP — đã xảy ra thật 04/08/2026.
        raise SystemExit(
            f"❌ Không đọc được API key của shop nào ({', '.join(missing)}).\n"
            f"   .env đang tìm ở: {os.getcwd()}/.env và cạnh file script.\n"
            f"   DỪNG — không ghi để khỏi xoá trắng {TABLE}."
        )
    if missing:
        print(f"⚠️  Thiếu API key {len(missing)}/{len(can_goi)} shop: {', '.join(missing)} "
              f"→ SP của các shop này sẽ BIẾN MẤT khỏi catalog sau khi ghi đè")

    all_rows = []
    for label, sid in can_goi:
        key = os.environ.get(f"TALPHA_POSCAKE_{label}_KEY", "")
        if not key:
            continue
        print(f"[{label}] fetching products...")
        all_rows.extend(fetch_shop_products(label, sid, key))

    # Dedupe theo variation_id (unique per shop). Giữ row đầu tiên.
    seen, deduped = set(), []
    for r in all_rows:
        vid = r["variation_id"]
        if vid and vid not in seen:
            seen.add(vid)
            deduped.append(r)

    print(f"\nTổng: {len(all_rows)} variation rows → {len(deduped)} unique variation_id")
    named = sum(1 for r in deduped if r["product_name"])
    print(f"Có tên SP: {named}/{len(deduped)} ({100*named/max(len(deduped),1):.0f}%)")

    tat = sorted({s["label"] for s in SHOPS if not s["keo"]})
    if args.dry_run:
        if tat:
            print(f"Nước không gọi POS {', '.join(tat)}: khi ghi thật sẽ giữ nguyên SP đang có trong {TABLE}")
        print("\n--dry-run: KHÔNG ghi. Sample 3 rows:")
        for r in deduped[:3]:
            print(" ", {k: r[k] for k in ["variation_id", "sku", "product_name", "retail_price", "cost", "shop_label"]})
        return

    conn = ket_noi()

    # ─── Nước không gọi POS (đã tắt / sắp chạy): GIỮ SP đang có của shop đó ───
    # Bảng thay cả bảng mỗi lần chạy, nên shop không gọi POS mà không mang SP cũ theo là
    # SP đó mất — đơn cũ của nước đó hết tra được giá vốn, P&L các ngày nó còn chạy bị sai.
    if tat:
        from psycopg.rows import dict_row
        with conn.cursor(row_factory=dict_row) as cur:
            giu = cur.execute(f"SELECT * FROM {TABLE} WHERE shop_label = ANY(%s)", (tat,)).fetchall()
        n_giu = 0
        for d in giu:
            if d.get("variation_id") and d["variation_id"] not in seen:
                seen.add(d["variation_id"])
                deduped.append(d)
                n_giu += 1
        print(f"Nước không gọi POS {', '.join(tat)}: giữ nguyên {n_giu} dòng SP đang có")

    # ─── Hàng rào chống ghi đè hụt ───
    # Thay bảng nằm trong một transaction nhưng KHÔNG hoàn tác được sau khi xong: POS lỗi giữa
    # chừng / hết key / đổi schema API là bảng dimension teo lại, kéo sập mọi báo cáo theo SP.
    # Hụt >30% so với bảng đang có ⇒ dừng, bắt người chạy xác nhận bằng --force.
    if len(deduped) == 0:
        raise SystemExit(f"❌ Fetch được 0 variation — DỪNG, giữ nguyên {TABLE}.")
    cur_n = conn.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
    if cur_n and len(deduped) < cur_n * 0.7 and not args.force:
        raise SystemExit(
            f"❌ Bảng mới {len(deduped)} dòng, hụt {100*(1-len(deduped)/cur_n):.0f}% "
            f"so với {cur_n} dòng đang có — DỪNG, giữ nguyên {TABLE}.\n"
            f"   Kiểm tra POS/API key trước. Chắc chắn đúng thì chạy lại với --force."
        )
    print(f"Bảng hiện có {cur_n} dòng → sẽ ghi {len(deduped)} dòng")

    pg_writer.thay_ca_bang(conn, TABLE, deduped)
    print(f"\n✅ Loaded {len(deduped)} rows → {TABLE}")

    # Verify coverage
    total, matched = conn.execute(f"""
      SELECT COUNT(*), COUNT(*) FILTER (WHERE c.variation_id IS NOT NULL)
      FROM order_items i
      LEFT JOIN {TABLE} c ON i.variation_id = c.variation_id
    """).fetchone()
    pct = 100 * matched / max(total, 1)
    print(f"✅ JOIN coverage: {matched:,}/{total:,} order_items khớp catalog ({pct:.1f}%)")
    conn.close()


if __name__ == "__main__":
    main()
