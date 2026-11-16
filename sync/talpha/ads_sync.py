"""
Kéo chi tiêu Meta Ads (cấp ad + cấp adset) của mọi TKQC → Postgres (fb_ads_tat_ca / fb_adset_tat_ca).

Tách khỏi talpha_sync.py (16/11/2026) — code chuyển nguyên văn; talpha_sync nhập lại sync_fb_ads
nên sync_month.py (`ts.sync_fb_ads`) chạy như cũ. Ghi raw chỉ thêm + dựng lại bảng trong MỘT
transaction (pg_writer.write_ads): TKQC lỗi không xoá được tiền ads đã có. Đừng ghi thẳng vào
fb_ads_data — nó là VIEW.
"""
import time
from datetime import datetime, timedelta

from sync.core import pg_writer
from sync.core.ad_accounts import meta_tokens
from sync.core.failed_accounts import split_failed_accounts
from sync.core.meta_client import MetaAdsClient, MetaFetchError
from sync.talpha.sync_runtime import _ad_accounts, _pg, log, sync_time


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
    # Mỗi TKQC đọc bằng token đầu tiên thấy nó (nhiều BM / app — sync/core/ad_accounts.py).
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
        # khi KHÔNG TK nào đọc được (token chết / app bị chặn). Xem sync/core/failed_accounts.py. Dòng
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
