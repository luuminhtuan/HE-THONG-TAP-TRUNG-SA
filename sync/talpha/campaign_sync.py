"""
Ngân sách campaign (fb_campaign_all) + từ điển ad_id (ad_dictionary) — gọi thẳng Graph API của Meta.

Tách khỏi talpha_sync.py (16/11/2026) — code chuyển nguyên văn; talpha_sync nhập lại
sync_campaign_data / sync_ad_dictionary nên sync_month.py chạy như cũ.
"""
import time

import requests

from sync.core import pg_writer
from sync.core.ad_accounts import meta_tokens
from sync.talpha.sync_runtime import FB_TOKEN, _ad_accounts, _pg, log, sync_time


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
    """Sync campaign budgets → fb_campaign_all (view fb_campaign_data lọc theo loại TKQC)."""
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

    n = pg_writer.replace_table(_pg(), 'fb_campaign_all', all_campaigns)
    log.info(f"  fb_campaign_all: {n} rows")
    return n
