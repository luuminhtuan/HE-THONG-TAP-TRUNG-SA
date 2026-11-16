"""
TALPHA Full Sync — v3 (sync/core refactor)

Orchestrator mỏng: mọi business logic nằm trong sync/core/.

Usage:
  python talpha_sync.py            # Full sync (ads + orders)
  python talpha_sync.py --ads      # Ads only
  python talpha_sync.py --orders   # Orders only
  python talpha_sync.py --full     # Force full re-fetch (bỏ qua Smart Stop)
  python talpha_sync.py --test     # Test connections
  python talpha_sync.py --days 7   # Ads backfill 7 ngày

Ghi vào Postgres ở DATABASE_URL (04/11/2026 — trước đó BigQuery; docs/POSTGRES.md). Đầu mỗi vòng: chạy
migration còn thiếu + dựng lại view nếu luật (tỷ giá, số chia, giá vốn…) đổi.
"""
import os, sys, json, time, logging, argparse, requests
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
# Khoá Google (tuỳ chọn) — chỉ bảng đơn đối tác 3PL đọc Google Sheet cần. Không có thì bước đó báo lỗi,
# đơn POS và tiền ads vẫn kéo bình thường.
if os.path.exists(os.path.join(PROJECT_DIR, 'bigquery_key.json')):
    os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', os.path.join(PROJECT_DIR, 'bigquery_key.json'))
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, PROJECT_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(PROJECT_DIR, '.env'))
# Khoá nhập ở /admin → Khoá kết nối (bảng api_credentials) thắng khoá cùng tên trong .env — nạp
# TRƯỚC khi đọc FB_TOKEN bên dưới.
from sync.core.credentials import load_credentials_to_env
load_credentials_to_env()

# ── sync/core imports ────────────────────────────────────────────
from sync.core.business_rules import STATUS_CATEGORY_MAP, convert_order_currency, pos_shops_from_markets
from sync.core.thi_truong import load_rules
from sync.core import pg_writer
from sync.core.pos_client import PoscakeClient, PosFetchError
from sync.core.partner_sheet import normalize_rows, read_sheet
from sync.core.meta_client import MetaAdsClient, MetaFetchError
from sync.core.tkqc import meta_tokens, ad_accounts_to_fetch
from sync.core.tk_loi import split_failed_accounts

# ── Config ───────────────────────────────────────────────────────
FB_TOKEN = (
    os.environ.get('TALPHA_META_ACCESS_TOKEN', '') or
    os.environ.get('AUUS1_META_ACCESS_TOKEN', '')
)
DISCORD_WEBHOOK = os.environ.get('DISCORD_WEBHOOK_ETL', '')

def _pos_shops():
    """Danh sách shop POS, đọc THẲNG từ config/talpha_rules.json → markets.

    HỆ MỚI 05/09/2026: MỘT thị trường Đài Loan ⇒ MỘT shop POS. 6 shop GCC
    (SA/AE/KW/OM/QA/BH) đã ngừng nên không còn trong config.

    Trước đây shop_id ghi cứng ở đây, và nó SAI: mã cũ 1328343252 là của hệ
    thống trước, key thật trả về "Cửa hàng không tồn tại". Ghi cứng ở hai nơi
    thì sớm muộn cũng lệch nhau — nay chỉ còn một chỗ khai là config.

    Luật dựng danh sách (nước sắp chạy, nước đã tắt) ở pos_shops_from_markets — có test. Luật đã
    phủ thị trường nhập ở /admin → Thị trường (sync/core/thi_truong.py, 04/11/2026).
    """
    return pos_shops_from_markets(load_rules(repo=PROJECT_DIR).get("markets") or {})


POS_SHOPS = _pos_shops()

# ── Logging ──────────────────────────────────────────────────────
log_dir = os.path.join(PROJECT_DIR, 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f'talpha_sync_{datetime.now().strftime("%Y%m%d_%H%M")}.log')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger('talpha_sync')

sync_time = datetime.utcnow().isoformat()

_pg_conn = None

def _pg():
    """Kết nối Postgres dùng chung cả vòng chạy; lần đầu nối thì chạy migration còn thiếu."""
    global _pg_conn
    if _pg_conn is None:
        from sync.core.pg import run_migrations, get_connection
        _pg_conn = get_connection()
        new_migrations = run_migrations(_pg_conn)
        if new_migrations:
            log.info(f"  [postgres] chạy migration: {', '.join(new_migrations)}")
    return _pg_conn

# ── TKQC: MỌI tài khoản token đọc được (04/11/2026) ──────────────
# Không còn danh sách gõ tay ở talpha.yaml — xem sync/core/tkqc.py. Hỏi một lần mỗi vòng chạy.
_ad_accounts_cache = None

def _ad_accounts() -> list:
    global _ad_accounts_cache
    if _ad_accounts_cache is None:
        tokens = meta_tokens()
        _ad_accounts_cache = ad_accounts_to_fetch(_pg(), tokens, load_rules(repo=PROJECT_DIR)) if tokens else []
        log.info(f"TKQC: {len(tokens)} token đọc được {len(_ad_accounts_cache)} tài khoản — kéo tất cả")
    return _ad_accounts_cache

# Cột của từng bảng khai bằng migration (db/migrations/), không khai ở đây.


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
        if not shop.get("keo", True):
            # Nước đã tắt / sắp chạy: không kéo đơn mới. Shop vẫn nằm trong POS_SHOPS để bước dựng
            # lại bên dưới giữ đơn cũ của nó (xem pos_shops_from_markets trong business_rules).
            reason = "đã tắt — không kéo đơn mới, giữ đơn cũ" if shop.get("trang_thai") == "da_tat" else "sắp chạy — chưa kéo đơn"
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


# ═══════════════════════════════════════════════════════════════════
# ADS SYNC — dùng MetaAdsClient từ sync/core
# ═══════════════════════════════════════════════════════════════════

def _transform_ads_row(r: dict, account_id: str, account_name: str) -> dict:
    """Transform 1 insight row → dòng fb_ads_data (ghi thẳng VND vì account billed VND)."""
    actions   = r.get('actions', []) or []
    act_vals  = r.get('action_values', []) or []

    def get_action(typ: str, cast=int) -> float:
        return sum(cast(a.get('value', 0)) for a in actions if a.get('action_type') == typ)
    def get_value(typ: str) -> float:
        return sum(float(a.get('value', 0)) for a in act_vals if a.get('action_type') == typ)

    spend_raw = float(r.get('spend', 0) or 0)  # Account billed VND → spend IS VND
    return {
        'ad_id':         str(r.get('ad_id', '')),
        'ad_name':       str(r.get('ad_name', '')),
        'adset_id':      str(r.get('adset_id', '')),
        'adset_name':    str(r.get('adset_name', '')),
        'campaign_id':   str(r.get('campaign_id', '')),
        'campaign_name': str(r.get('campaign_name', '')),
        'account_id':    account_id.replace('act_', ''),
        'account_name':  account_name,
        'date':          str(r.get('date_start', '')),
        'spend':         spend_raw,
        'spend_usd':     0.0,   # account VND — không có USD equivalent
        'impressions':   int(r.get('impressions', 0) or 0),
        'clicks':        int(r.get('clicks', 0) or 0),
        'reach':         int(r.get('reach', 0) or 0),
        'purchases':     get_action('purchase'),
        'purchase_value': get_value('purchase'),
        'leads':         float(get_action('lead')),
        'messaging_conversations_started': get_action('onsite_conversion.messaging_conversation_started_7d'),
        'add_to_cart':   get_action('add_to_cart'),
        'cpm':           float(r.get('cpm', 0) or 0),
        'ctr':           float(r.get('ctr', 0) or 0),
        'cpc':           float(r.get('cpc', 0) or 0),
        'frequency':     float(r.get('frequency', 0) or 0),
        'project_id':    'TALPHA',
        'sync_time':     sync_time,
    }


def _transform_adset_row(r: dict, account_id: str, account_name: str) -> dict:
    """Transform 1 adset-level insight row → dòng fb_adset_data (field set = engine runtime)."""
    actions  = r.get('actions', []) or []
    act_vals = r.get('action_values', []) or []
    return {
        'adset_id':      str(r.get('adset_id', '')),
        'adset_name':    str(r.get('adset_name', '')),
        'campaign_id':   str(r.get('campaign_id', '')),
        'campaign_name': str(r.get('campaign_name', '')),
        'account_id':    account_id.replace('act_', ''),
        'account_name':  account_name,
        'date':          str(r.get('date_start', '')),
        'spend':         float(r.get('spend', 0) or 0),
        'impressions':   int(r.get('impressions', 0) or 0),
        'reach':         int(r.get('reach', 0) or 0),
        'clicks':        int(r.get('clicks', 0) or 0),
        'cpm':           float(r.get('cpm', 0) or 0),
        'ctr':           float(r.get('ctr', 0) or 0),
        'cpc':           float(r.get('cpc', 0) or 0),
        'frequency':     float(r.get('frequency', 0) or 0),
        'purchases':     sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'purchase'),
        'purchase_value': sum(float(a.get('value', 0)) for a in act_vals if a.get('action_type') == 'purchase'),
        'leads':         sum(int(a.get('value', 0)) for a in actions if a.get('action_type') == 'lead'),
        'messaging_conversations_started': sum(
            int(a.get('value', 0)) for a in actions
            if a.get('action_type') == 'onsite_conversion.messaging_conversation_started_7d'
        ),
        'project_id':    'TALPHA',
        'sync_time':     sync_time,
    }


def _is_permanent_meta_error(err) -> bool:
    """Lỗi Meta thuộc loại KHÔNG bao giờ tự khỏi khi thử lại.

    Chủ tài khoản chưa cấp quyền, tài khoản không tồn tại, token sai app —
    những cái đó phải người vào Business Manager sửa, chờ bao lâu cũng vậy.
    Khác hẳn rate limit hay lỗi mạng, vốn đáng chờ rồi thử lại.
    """
    t = str(err).lower()
    return any(k in t for k in (
        "has not grant",            # (#200) chủ tài khoản chưa cấp ads_read/ads_management
        "not grant ads_management",
        "does not exist",
        "unsupported get request",
        "malformed access token",
        "session has expired",
    ))


def sync_fb_ads(days_back: int = 1, since: str = None, until: str = None) -> tuple[int, int]:
    """Fetch Meta Ads insights → Postgres theo cơ chế raw/rebuild (X2).

    `days_back` chỉ quyết định NGÀY NÀO ĐƯỢC LÀM MỚI, không còn quyết định ngày nào
    bị xoá — bản cũ WRITE_TRUNCATE cả bảng nên mỗi lần sang tháng mới là mất sạch
    tháng trước.

    `since`/`until`: chỉ định thẳng khoảng ngày, dùng để BACKFILL tháng cũ (kéo theo
    từng tháng cho nhẹ, tránh chạm rate limit của Meta).
    """
    if not meta_tokens():
        log.error("TALPHA_META_ACCESS_TOKEN not set!")
        return 0, 0

    today = until or datetime.utcnow().strftime('%Y-%m-%d')
    since = since or (datetime.utcnow() - timedelta(days=days_back)).strftime('%Y-%m-%d')
    # Mỗi TKQC đọc bằng token đầu tiên thấy nó (nhiều BM / app — sync/core/tkqc.py).
    client_by_token = {}

    fields = (
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,"
        "spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,"
        "actions,action_values"
    )
    adset_fields = (
        "adset_id,adset_name,campaign_id,campaign_name,"
        "spend,impressions,reach,clicks,cpm,ctr,cpc,frequency,"
        "actions,action_values"
    )
    all_ads, all_adsets = [], []
    failed = []
    for acct in _ad_accounts():
        log.info(f"  {acct['name']} ({acct['id']})...")
        rows = None
        lost_access = False
        # Retry cả account (ngoài retry trong _request) — account lớn hay timeout/limit.
        for attempt in range(3):
            try:
                meta = client_by_token.setdefault(acct['token'], MetaAdsClient(access_token=acct['token']))
                rows = meta.fetch_ads_insights(
                    account_id=acct['id'], date_start=since, date_stop=today,
                    fields=fields.split(','), level='ad',
                )
                break
            except MetaFetchError as e:
                log.error(f"    {acct['name']} fetch lỗi (lần {attempt+1}/3): {e}")
                # Lỗi PHÂN QUYỀN không bao giờ tự hết — thử lại chỉ tốn thời gian.
                # Config từng khai 15 tài khoản của hệ thống cũ mà token mới không
                # có quyền cái nào: 15 × 3 lần × 32 giây = 24 PHÚT mỗi vòng sync,
                # để rồi vẫn ghi 0 dòng. Chỉ thử lại lỗi tạm thời (mạng, rate limit).
                if _is_permanent_meta_error(e):
                    log.error(f"    ⚠️ {acct['name']}: lỗi phân quyền — bỏ qua, không thử lại.")
                    # "Chưa cấp quyền" = MẤT QUYỀN (bot Zalo khuyên gỡ TK). Token hết hạn / sai cũng
                    # là lỗi vĩnh viễn nhưng hỏng MỌI TK — tach_tk_loi chặn vì không TK nào đọc được.
                    lost_access = "has not grant" in str(e).lower()
                    break
                if attempt < 2:
                    time.sleep(30)
        if rows is None:
            failed.append({'name': acct['name'], 'id': acct['id'], 'mat_quyen': lost_access})
            log.error(f"    ⚠️ {acct['name']}: fetch THẤT BẠI hẳn — KHÔNG nạp 0 đè, sẽ hủy load.")
            continue
        for r in rows:
            all_ads.append(_transform_ads_row(r, acct['id'], acct['name']))
        log.info(f"    → {len(rows)} ad rows")

        # Adset-level (port từ engine runtime): BEST-EFFORT như runtime —
        # account fail chỉ log + bỏ qua, KHÔNG hủy cả lượt (fb_adset_data là bảng phụ).
        try:
            meta = client_by_token.setdefault(acct['token'], MetaAdsClient(access_token=acct['token']))
            rows2 = meta.fetch_ads_insights(
                account_id=acct['id'], date_start=since, date_stop=today,
                fields=adset_fields.split(','), level='adset',
            )
            for r in rows2:
                all_adsets.append(_transform_adset_row(r, acct['id'], acct['name']))
            log.info(f"    → {len(rows2)} adset rows")
        except MetaFetchError as e:
            log.error(f"    Adset {acct['name']} fetch lỗi (bỏ qua, best-effort): {e}")

    # X2: append/rebuild nên account lỗi KHÔNG còn xoá được spend đã có — dòng của
    # account đó chỉ giữ bản cũ. Vẫn raise ở cuối để báo cảnh, nhưng ghi trước đã.
    if all_ads:
        n_ads = pg_writer.write_ads(_pg(), all_ads, 'fb_ads_tat_ca', 'ad_id')
        n_adsets = pg_writer.write_ads(_pg(), all_adsets, 'fb_adset_tat_ca', 'adset_id')
        log.info(f"  ads window {since}→{today} (cửa sổ chỉ làm mới, không xoá lịch sử)")
    else:
        log.warning("  Không fetch được insight ads từ bất kỳ account nào!")
        n_ads = n_adsets = 0

    if failed:
        # 28/10/2026 (Sỹ Anh): TK nào chết thì kệ nó, vẫn ghi Sheet bằng các TK còn lại — chỉ chặn
        # khi KHÔNG TK nào đọc được (token chết / app bị chặn). Xem sync/core/tk_loi.py. Dòng
        # "TKQC BỎ QUA …" dưới đây được daily_guarded.sh bóc thành nhãn TKQC_BO_QUA để bot Zalo
        # báo tên — đừng đổi chữ.
        skipped, blocked = split_failed_accounts(failed, len(_ad_accounts()))
        if skipped:
            log.warning(
                f"  TKQC BỎ QUA (không đọc được, giữ số đã có): {[f['name'] for f in skipped]} "
                f"— vẫn ghi số các TK còn lại; TK chết hẳn thì gỡ khỏi config/projects/talpha.yaml."
            )
        if blocked:
            raise RuntimeError(
                f"Đã ghi {n_ads} dòng ads nhưng {len(blocked)} account fetch thất bại {[f['name'] for f in blocked]} "
                f"— không TK nào đọc được (token chết / app bị chặn?). Chạy lại khi Meta ổn."
            )
    return n_ads, n_adsets


# ═══════════════════════════════════════════════════════════════════
# CAMPAIGN BUDGET SYNC (giữ nguyên — chưa có trong meta_client)
# ═══════════════════════════════════════════════════════════════════

def sync_ad_dictionary(max_ids: int = 600) -> int:
    """X9 — tra Meta cho ad_id nằm trên ĐƠN nhưng không có trong fb_ads_data → bảng
    `ad_dictionary` (ad_id, account, campaign_name) cho attribution bậc 2.

    Vì sao cần: insights chỉ trả ad_id HIỆN TẠI. Ad bị xoá/tạo lại thì id cũ (đã đóng
    dấu vào đơn qua utm lúc khách bấm) không bao giờ xuất hiện trong fb_ads_data —
    nhưng hỏi thẳng /{ad_id} thì Meta vẫn trả account + campaign. Bắt luôn ad của
    TKQC NGOÀI roster (team khác chung shop POS). Append-only, id lỗi cũng ghi
    (status='error') để không tra lại mãi.
    """
    api = 'https://graph.facebook.com/v21.0'
    ids = pg_writer.ad_ids_to_lookup(_pg(), 'sale_order', max_ids)
    if not ids:
        log.info("  ad_dictionary: không có id mới cần tra")
        return 0
    return _lookup_ad_dictionary(api, ids)


def _lookup_ad_dictionary(api: str, ids: list) -> int:
    log.info(f"  ad_dictionary: tra Meta {len(ids)} ad_id lạ (batch 50)...")
    out, acc_names = [], {}
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        try:
            data = requests.get(f'{api}/', params={
                'ids': ','.join(batch),
                'fields': 'account_id,name,campaign{id,name}',
                'access_token': FB_TOKEN}, timeout=90).json()
        except Exception as e:
            log.warning(f"  ad_dictionary batch lỗi mạng: {e} — bỏ batch, vòng sau tra lại")
            continue
        if isinstance(data, dict) and data.get('error'):
            # 1 id hỏng làm chết cả lô → tra lẻ
            data = {}
            for aid in batch:
                try:
                    data[aid] = requests.get(f'{api}/{aid}', params={
                        'fields': 'account_id,name,campaign{id,name}',
                        'access_token': FB_TOKEN}, timeout=30).json()
                except Exception:
                    data[aid] = {'error': True}
                time.sleep(0.2)
        for aid in batch:
            d = data.get(aid) or {}
            if not d or d.get('error'):
                out.append({'ad_id': aid, 'account_id': '', 'account_name': '',
                            'campaign_id': '', 'campaign_name': '', 'ad_name': '',
                            'status': 'error', 'sync_time': sync_time})
                continue
            acc = str(d.get('account_id', '') or '')
            if acc and acc not in acc_names:
                try:
                    an = requests.get(f'{api}/act_{acc}', params={
                        'fields': 'name', 'access_token': FB_TOKEN}, timeout=30).json()
                    acc_names[acc] = str(an.get('name', '') or '')
                except Exception:
                    acc_names[acc] = ''
            camp = d.get('campaign') or {}
            out.append({'ad_id': aid, 'account_id': acc,
                        'account_name': acc_names.get(acc, ''),
                        'campaign_id': str(camp.get('id', '') or ''),
                        'campaign_name': str(camp.get('name', '') or ''),
                        'ad_name': str(d.get('name', '') or ''),
                        'status': 'ok', 'sync_time': sync_time})
        time.sleep(0.5)

    if not out:
        return 0
    with _pg().transaction():
        pg_writer.insert_rows(_pg(), 'ad_dictionary', out)
    ok = sum(1 for r in out if r['status'] == 'ok')
    log.info(f"  ad_dictionary: +{len(out)} id ({ok} tra được, {len(out)-ok} lỗi)")
    return len(out)


def sync_campaign_data() -> int:
    """Sync campaign budgets → fb_campaign_tat_ca (view fb_campaign_data lọc theo loại TKQC)."""
    if not meta_tokens():
        log.error("TALPHA_META_ACCESS_TOKEN not set!")
        return 0

    all_campaigns = []
    for acct in _ad_accounts():
        acct_id = acct['id']
        try:
            resp = requests.get(
                f'https://graph.facebook.com/v21.0/{acct_id}/campaigns',
                params={
                    'fields': 'id,name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,objective,start_time,stop_time',
                    'effective_status': '["ACTIVE","PAUSED","ARCHIVED"]',
                    'limit': '500',
                    'access_token': acct['token'],
                },
                timeout=60,
            )
            data = resp.json()
            if 'error' in data:
                log.error(f"  [{acct_id}] {data['error'].get('message','')[:150]}")
                continue
            rows = data.get('data', [])
            while 'paging' in data and 'next' in data.get('paging', {}):
                data = requests.get(data['paging']['next'], timeout=60).json()
                rows.extend(data.get('data', []))
            for r in rows:
                all_campaigns.append({
                    'campaign_id':      str(r.get('id', '')),
                    'campaign_name':    str(r.get('name', '')),
                    'status':           str(r.get('status', '')),
                    'effective_status': str(r.get('effective_status', '')),
                    'daily_budget':     float(r.get('daily_budget') or 0) / 100,
                    'lifetime_budget':  float(r.get('lifetime_budget') or 0) / 100,
                    'budget_remaining': float(r.get('budget_remaining') or 0) / 100,
                    'objective':        str(r.get('objective', '')),
                    'start_time':       str(r.get('start_time', '') or ''),
                    'stop_time':        str(r.get('stop_time', '') or ''),
                    'account_id':       acct_id.replace('act_', ''),
                    'sync_time':        sync_time,
                })
            log.info(f"  [{acct_id}] {len(rows)} campaigns")
        except Exception as e:
            log.error(f"  [{acct_id}] Campaign error: {e}")
        time.sleep(0.5)

    n = pg_writer.replace_table(_pg(), 'fb_campaign_tat_ca', all_campaigns)
    log.info(f"  fb_campaign_tat_ca: {n} rows")
    return n


# ═══════════════════════════════════════════════════════════════════
# BẢNG ĐƠN ĐỐI TÁC (Google Sheet) → partner_orders
# ═══════════════════════════════════════════════════════════════════

def sync_partner_orders() -> int:
    """Bảng đơn đối tác (config/talpha_rules.json → partner_orders.sheets) → Postgres.

    Thay CẢ bảng một lần trong một transaction. Một bảng đọc lỗi thì NÉM lỗi và KHÔNG ghi gì —
    thay bằng các bảng còn lại là xoá mất dòng của bảng lỗi. Tiền COD giữ
    nguyên đơn vị trong bảng đối tác (cột currency), không quy đổi ở đây.
    """
    with open(os.path.join(PROJECT_DIR, "config", "talpha_rules.json"), encoding="utf-8") as fh:
        cfg = json.load(fh).get("partner_orders") or {}
    sheets = [x for x in cfg.get("sheets") or [] if isinstance(x, dict) and x.get("sheet_id")]
    if not sheets:
        log.info("  partner_orders: chưa khai bảng nào — bỏ qua")
        return 0
    # Không có khoá Google thì doc_sheet đọc qua link công khai như bảng NAZA của Đài (05/11/2026);
    # bảng để riêng tư thì báo lỗi rõ và GIỮ bảng cũ.
    rows = []
    for sh in sheets:
        values = read_sheet(sh["sheet_id"], str(sh.get("sheet_gid", "0")))
        sheet_rows = normalize_rows(values, cfg.get("column_map") or {},
                          {"market": sh.get("market", ""), "shop_label": sh.get("shop_label", ""),
                           "sheet_id": sh["sheet_id"]}, sync_time)
        log.info(f"  [{sh.get('shop_label')}] bảng đối tác: {len(sheet_rows)} đơn")
        rows.extend(sheet_rows)
    table = cfg.get("table") or "partner_orders"
    n = pg_writer.replace_table(_pg(), table, rows)
    log.info(f"  {table}: {n} rows")
    return n


# ═══════════════════════════════════════════════════════════════════
# CONNECTION TEST
# ═══════════════════════════════════════════════════════════════════

def test_connections():
    """Kiểm tra token Meta + POS API keys trước khi sync thật."""
    for token_var, tok in meta_tokens():
        d = requests.get('https://graph.facebook.com/v21.0/me', params={'access_token': tok}, timeout=10).json()
        log.info(f"  {token_var}: {d.get('name', d.get('error', {}).get('message', '?'))}")
    if meta_tokens():
        log.info(f"  Ad accounts: {len(_ad_accounts())}")
    else:
        log.warning("  Meta token: NOT SET")

    log.info("  POS shops:")
    for shop in POS_SHOPS:
        if not shop.get("keo", True):
            log.info(f"    {shop['label']}: nước {shop.get('trang_thai')} — không gọi POS")
        elif shop["key"]:
            pos = PoscakeClient(
                api_key=shop["key"], shop_label=shop["label"],
                shop_id="", currency=shop["currency"],
            )
            sid = pos._discover_shop_id()
            log.info(f"    {shop['label']}: shop_id={sid or 'NOT FOUND'}")
        else:
            log.info(f"    {shop['label']}: NO API KEY")


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='TALPHA Full Sync v3')
    parser.add_argument('--ads',    action='store_true', help='Ads only')
    parser.add_argument('--orders', action='store_true', help='Orders only')
    parser.add_argument('--full',   action='store_true',
                        help='Kéo TOÀN BỘ lịch sử đơn (backfill) thay vì cửa sổ ngày')
    parser.add_argument('--window-days', type=int,
                        default=int(os.getenv('TALPHA_ORDER_WINDOW_DAYS', '30')),
                        help='Số ngày lùi lại theo ngày TẠO đơn (mặc định 60)')
    parser.add_argument('--test',   action='store_true', help='Test connections')
    parser.add_argument('--days',   type=int, default=1, help='Days back for ads (default: 1)')
    args = parser.parse_args()

    if args.test:
        test_connections()
        return

    start    = datetime.now()
    run_all  = not (args.ads or args.orders)
    results  = {'errors': []}

    log.info("═" * 60)
    log.info("TALPHA SYNC v3  [Postgres]")
    log.info(f"Mode: {'FULL' if run_all else ('ADS' if args.ads else 'ORDERS')} | "
             f"{'full-fetch' if args.full else 'incremental'}")
    log.info("═" * 60)

    _pg()   # nối + migrate ngay đầu: Postgres không lên thì dừng trước khi gọi Meta / POS

    # Luật đổi (thêm nước / sửa tỷ giá trên /admin → Thị trường, khai giá vốn…) → view phải dựng lại,
    # nếu không các tab tính nước mới ra doanh thu 0. Không chặn vòng chạy: dựng lỗi thì đơn và tiền
    # ads vẫn kéo bình thường, lỗi báo ra và vòng sau thử lại.
    try:
        from sync.core.pg_view import rebuild_views
        results['view_dung_lai'] = rebuild_views(_pg())
        if results['view_dung_lai']:
            log.info("  Luật đổi — đã dựng lại bộ view")
    except (Exception, SystemExit) as e:   # SystemExit: bộ dựng view dừng khi luật khai thiếu
        log.error(f"  Dựng lại view lỗi: {e}")
        results['errors'].append(f"view: {e}")

    if run_all or args.orders:
        log.info(f"\n[1/3] Orders (POS {len(POS_SHOPS)} shop)...")
        try:
            win = None if args.full else (
                datetime.now() - timedelta(days=args.window_days)
            ).strftime('%Y-%m-%dT00:00:00')
            log.info(f"  Cửa sổ đơn: {'TOÀN BỘ lịch sử' if win is None else f'tạo từ {win}'}")
            n_o, n_i = sync_all_orders(window_start=win)
            results['orders'] = n_o
            results['items']  = n_i
        except Exception as e:
            log.error(f"  Orders failed: {e}", exc_info=True)
            results['errors'].append(f"orders: {e}")

    if run_all or args.orders:
        # Bảng đơn đối tác 3PL (Google Sheet). KHÔNG chặn vòng chạy và không tính là lỗi sync:
        # đơn POS và tiền ads vẫn là số chính; bảng đối tác là số tra thêm.
        try:
            results['partner_orders'] = sync_partner_orders()
        except Exception as e:
            log.error(f"  partner_orders failed (bảng cũ giữ nguyên): {e}")

    if run_all or args.ads:
        log.info(f"\n[2/3] FB Ads (last {args.days} days)...")
        try:
            n_a, n_as = sync_fb_ads(days_back=args.days)
            results['ads'] = n_a
            results['adsets'] = n_as
        except Exception as e:
            log.error(f"  Ads failed: {e}", exc_info=True)
            results['errors'].append(f"ads: {e}")

    if run_all or args.ads:
        log.info("\n[3/3] Campaign budgets...")
        try:
            results['campaigns'] = sync_campaign_data()
        except Exception as e:
            log.error(f"  Campaign sync failed: {e}", exc_info=True)
            results['errors'].append(f"campaigns: {e}")
        # X9: từ điển ad_id cho attribution bậc 2 — không chặn vòng chạy
        try:
            results['ad_dic'] = sync_ad_dictionary()
        except Exception as e:
            log.error(f"  ad_dictionary failed: {e}")

    if _pg_conn is not None:
        _pg_conn.close()

    elapsed = (datetime.now() - start).total_seconds()
    log.info(f"\nDONE {elapsed:.0f}s — {results}")

    if DISCORD_WEBHOOK:
        errs = results.get('errors', [])
        ok = len(errs) == 0
        embed = {
            'title': '✅ TALPHA Sync v3' if ok else '⚠️ TALPHA Sync v3 — CÓ LỖI',
            'color': 0x2ECC71 if ok else 0xE74C3C,
            'fields': [
                {'name': 'Orders', 'value': str(results.get('orders', 0)), 'inline': True},
                {'name': 'Items',  'value': str(results.get('items', 0)),  'inline': True},
                {'name': 'Ads',    'value': str(results.get('ads', 0)),    'inline': True},
                {'name': 'Thời gian', 'value': f'{elapsed:.0f}s', 'inline': True},
                {'name': 'Errors', 'value': str(len(errs)), 'inline': True},
            ],
        }
        if errs:
            # Liệt kê tối đa 5 lỗi đầu để dễ debug
            embed['fields'].append({
                'name': 'Chi tiết lỗi',
                'value': '\n'.join(f'• {e[:200]}' for e in errs[:5]) or '—',
                'inline': False,
            })
        try:
            requests.post(DISCORD_WEBHOOK, json={'embeds': [embed]}, timeout=10)
        except Exception:
            pass


if __name__ == '__main__':
    main()
