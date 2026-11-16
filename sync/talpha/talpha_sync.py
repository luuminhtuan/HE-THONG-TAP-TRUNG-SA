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
import os, sys, argparse, requests
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, PROJECT_DIR)

# ── Các khối của vòng sync (tách 16/11/2026 — trước đó file này 786 dòng) ─────
# sync_runtime: khởi động (khoá Google, .env, khoá kết nối nhập ở /admin) + bối cảnh chung (token,
# shop POS, log, Postgres) — nạp ĐẦU TIÊN. Mỗi khối kéo / ghi một file. Nhập lại các tên cũ:
# sync_month.py gọi ts.sync_all_orders / sync_fb_ads / sync_campaign_data / sync_ad_dictionary.
from sync.talpha import sync_runtime  # noqa: E402  (cần PROJECT_DIR trong sys.path ở trên)
from sync.core.ad_accounts import meta_tokens
from sync.core.pos_client import PoscakeClient
from sync.talpha.sync_runtime import (  # noqa: F401
    DISCORD_WEBHOOK, FB_TOKEN, POS_SHOPS, _ad_accounts, _pg, log, sync_time,
)
from sync.talpha.order_sync import _drop_foreign_currency, _shop_cutoff, sync_all_orders  # noqa: F401
from sync.talpha.ads_sync import (  # noqa: F401
    _is_permanent_meta_error, _transform_adset_row, _transform_ads_row, sync_fb_ads,
)
from sync.talpha.campaign_sync import _lookup_ad_dictionary, sync_ad_dictionary, sync_campaign_data  # noqa: F401
from sync.talpha.partner_orders_sync import sync_partner_orders


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

    sync_runtime.close_pg()

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
