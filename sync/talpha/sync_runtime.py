"""
Bối cảnh chung của MỘT vòng sync (sync/talpha/talpha_sync.py): token Meta, danh sách shop POS, log,
mốc giờ sync_time, kết nối Postgres dùng chung, danh bạ TKQC của vòng chạy.

Tách khỏi talpha_sync.py (16/11/2026, file đó 786 dòng) — code chuyển nguyên văn. Các khối kéo đơn /
kéo Meta / bảng đối tác (order_sync, ads_sync, campaign_sync, partner_orders_sync) cùng đọc từ đây.
Vẫn chỉ có MỘT engine sync, điểm chạy là talpha_sync.py. Bước khởi động (khoá Google, .env, khoá
kết nối nhập ở /admin — bảng api_credentials) chạy NGAY KHI nạp file này, trước khi đọc FB_TOKEN —
khối nào được nạp trước (talpha_sync, sync_month qua talpha_sync, hay nạp thẳng một khối) cũng
thấy đúng khoá.
"""
import logging
import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
# Khoá Google (tuỳ chọn) — chỉ bảng đơn đối tác 3PL đọc Google Sheet cần. Không có thì bước đó báo lỗi,
# đơn POS và tiền ads vẫn kéo bình thường.
if os.path.exists(os.path.join(PROJECT_DIR, 'bigquery_key.json')):
    os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', os.path.join(PROJECT_DIR, 'bigquery_key.json'))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(PROJECT_DIR, '.env'))
# Khoá nhập ở /admin → Khoá kết nối (bảng api_credentials) thắng khoá cùng tên trong .env — nạp
# TRƯỚC khi đọc FB_TOKEN bên dưới.
from sync.core.credentials import load_credentials_to_env  # noqa: E402
load_credentials_to_env()

# ── sync/core imports ────────────────────────────────────────────
from sync.core.ad_accounts import ad_accounts_to_fetch, meta_tokens  # noqa: E402
from sync.core.business_rules import pos_shops_from_markets  # noqa: E402
from sync.core.market_config import load_rules  # noqa: E402

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
    phủ thị trường nhập ở /admin → Thị trường (sync/core/market_config.py, 04/11/2026).
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
# Không còn danh sách gõ tay ở talpha.yaml — xem sync/core/ad_accounts.py. Hỏi một lần mỗi vòng chạy.
_ad_accounts_cache = None


def _ad_accounts() -> list:
    global _ad_accounts_cache
    if _ad_accounts_cache is None:
        tokens = meta_tokens()
        _ad_accounts_cache = ad_accounts_to_fetch(_pg(), tokens, load_rules(repo=PROJECT_DIR)) if tokens else []
        log.info(f"TKQC: {len(tokens)} token đọc được {len(_ad_accounts_cache)} tài khoản — kéo tất cả")
    return _ad_accounts_cache


def close_pg() -> None:
    """Đóng kết nối Postgres của vòng chạy nếu đã mở (cuối main của talpha_sync)."""
    if _pg_conn is not None:
        _pg_conn.close()
