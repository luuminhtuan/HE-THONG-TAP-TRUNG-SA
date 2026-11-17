"""Kéo hộp thư Pancake vào Postgres — chạy mỗi 5 phút (VPS: talpha-pancake.timer; Docker: scheduler, việc "tin_nhan").

Cho tab Tin nhắn (17/11/2026): dashboard XEM từ bảng pancake_* (migration 0004), không gọi Pancake lúc xem.
Mỗi lượt, với mỗi page các token Pancake thấy (TALPHA_PANCAKE_API_TOKEN, _2, _3 — trùng page thì token đầu thắng):
  1. lật hội thoại (mới → cũ) tới khi chạm mốc đã kéo (pancake_pages.synced_until) — lần đầu: backfill_days ngày;
  2. hội thoại có tin mới: kéo tin, ghi thêm (trùng id thì bỏ) — mỗi hội thoại một transaction, dừng giữa chừng không mất;
  3. page xong hết mới dời mốc synced_until — lượt sau làm lại phần dở, không sót.
Cuối lượt xoá tin / hội thoại cũ hơn retention_days. Hai lượt không chồng nhau (advisory lock).
Luật: talpha_rules.json → pancake_inbox. Phần thuần (đọc dữ liệu Pancake, gán page → nước): sync/core/pancake_inbox.py.

    python sync/talpha/pancake_inbox_sync.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)
from sync.core import pancake_inbox as P  # noqa: E402
from sync.core.credentials import load_credentials_to_env  # noqa: E402
from sync.core.market_config import load_rules  # noqa: E402
from sync.core.pg import get_connection  # noqa: E402

API = "https://pages.fm/api/v1"
TOKEN_VARS = ("TALPHA_PANCAKE_API_TOKEN", "TALPHA_PANCAKE_API_TOKEN_2", "TALPHA_PANCAKE_API_TOKEN_3")
LOCK_KEY = 7_311_017          # pg_try_advisory_lock — một lượt một lúc
RUN_BUDGET_S = 240            # lượt chạy quá 4 phút thì dừng page kế tiếp (lượt sau làm nốt)


class PancakeError(RuntimeError):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


def log(*a):
    print(datetime.now().strftime("%F %T"), "[pancake]", *a, flush=True)


def call(path, tok, interval_s, **params):
    """GET Pancake → JSON. 429 → chờ 5 · 10 · 20 · 40s. success=false → PancakeError (mã 121 = tài khoản không có gói cước)."""
    params["access_token"] = tok
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(5):
        time.sleep(interval_s)
        try:
            with urllib.request.urlopen(url, timeout=30) as r:  # nosec B310 — URL cố định https://pages.fm
                j = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * 2 ** attempt)
                continue
            raise PancakeError(f"HTTP {e.code}", e.code) from None
        if isinstance(j, dict) and j.get("success") is False:
            raise PancakeError(str(j.get("message") or "lỗi"), j.get("error_code"))
        return j
    raise PancakeError("429 — gọi dồn quá", 429)


def campaign_pages(conn, rules):
    """[(tên page trong tên camp, mã nước)] từ chi tiêu 120 ngày gần nhất — để gán page → nước."""
    sys.path.insert(0, os.path.join(REPO, "ops", "talpha_reports"))
    from campaign_pages import parse_camp_product
    from talpha_rules import campaign_market
    code_of = {k: v.get("shop_label") for k, v in rules["markets"].items() if isinstance(v, dict)}
    rows = conn.execute("SELECT DISTINCT campaign_name FROM fb_ads_all WHERE date >= current_date - 120").fetchall()
    out = []
    for (cn,) in rows:
        page = parse_camp_product(cn)[1]
        market, source = campaign_market(cn)
        if page and source != "mac_dinh" and code_of.get(market):
            out.append((page, code_of[market]))
    return out


def upsert_conversation(conn, page_id, c):
    conn.execute(
        """INSERT INTO pancake_conversations (page_id, conversation_id, type, customer_name, customer_id, phone_numbers,
                                             snippet, tags, inserted_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s)
           ON CONFLICT (page_id, conversation_id) DO UPDATE SET type = EXCLUDED.type,
               customer_name = COALESCE(EXCLUDED.customer_name, pancake_conversations.customer_name),
               customer_id = COALESCE(EXCLUDED.customer_id, pancake_conversations.customer_id),
               phone_numbers = EXCLUDED.phone_numbers, snippet = EXCLUDED.snippet, tags = EXCLUDED.tags,
               inserted_at = COALESCE(pancake_conversations.inserted_at, EXCLUDED.inserted_at), updated_at = EXCLUDED.updated_at""",
        (page_id, c["conversation_id"], c["type"], c["customer_name"], c["customer_id"], json.dumps(c["phone_numbers"]),
         c["snippet"], json.dumps(c["tags"], ensure_ascii=False), c["inserted_at"], c["updated_at"]))


def sync_messages(conn, page_id, c, tok, cfg):
    """Kéo tin của một hội thoại; lô đầu toàn tin mới thì lật thêm (current_count) tới khi gặp tin đã có. Trả số tin mới."""
    added, cc = 0, 0
    for _ in range(int(cfg["max_message_pages_per_conversation"])):
        j = call(f"/pages/{page_id}/conversations/{c['conversation_id']}/messages", tok,
                 cfg["call_interval_ms"] / 1000, **({"current_count": cc} if cc else {}))
        batch = [P.normalize_message(m, page_id) for m in (j.get("messages") or []) if isinstance(m, dict)]
        batch = [m for m in batch if m["message_id"]]
        new_here = 0
        with conn.transaction():
            for m in batch:
                cur = conn.execute(
                    """INSERT INTO pancake_messages (page_id, conversation_id, message_id, from_page, sender_name, body,
                                                     attachments, sent_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s) ON CONFLICT DO NOTHING""",
                    (page_id, c["conversation_id"], m["message_id"], m["from_page"], m["sender_name"], m["body"],
                     json.dumps(m["attachments"], ensure_ascii=False), m["sent_at"]))
                new_here += cur.rowcount
        added += new_here
        if not batch or new_here < len(batch):      # gặp tin đã có / hết tin
            break
        cc += len(batch)
    conn.execute("UPDATE pancake_conversations SET messages_synced_at = updated_at WHERE page_id = %s AND conversation_id = %s",
                 (page_id, c["conversation_id"]))
    return added


def sync_page(conn, page_id, tok, cfg, synced_until):
    """Hội thoại mới hơn mốc + tin của chúng. Trả (số hội thoại, số tin mới, mốc mới)."""
    floor = synced_until or (datetime.now(timezone.utc) - timedelta(days=int(cfg["backfill_days"])))
    changed, cc = [], 0
    for _ in range(int(cfg["max_batches_per_page"])):
        j = call(f"/pages/{page_id}/conversations", tok, cfg["call_interval_ms"] / 1000, current_count=cc)
        batch = [P.normalize_conversation(r) for r in (j.get("conversations") or []) if isinstance(r, dict)]
        changed += [c for c in batch if c["conversation_id"] and c["updated_at"] and c["updated_at"] > floor]
        if P.batch_reaches(batch, floor):
            break
        cc += len(batch)
    changed.sort(key=lambda c: c["updated_at"])          # cũ trước: dừng giữa chừng thì phần đã xong là phần cũ
    added = 0
    for c in changed:
        upsert_conversation(conn, page_id, c)
        added += sync_messages(conn, page_id, c, tok, cfg)
    newest = max((c["updated_at"] for c in changed), default=synced_until)
    return len(changed), added, newest


def purge(conn, days):
    with conn.transaction():
        m = conn.execute("DELETE FROM pancake_messages WHERE sent_at < now() - make_interval(days => %s)", (days,)).rowcount
        c = conn.execute("""DELETE FROM pancake_conversations WHERE updated_at < now() - make_interval(days => %s)""", (days,)).rowcount
    if m or c:
        log(f"xoá {c} hội thoại, {m} tin cũ hơn {days} ngày")


def main() -> int:
    load_credentials_to_env()
    rules = load_rules()
    cfg = rules["pancake_inbox"]
    tokens = [(v, os.environ.get(v, "").strip()) for v in TOKEN_VARS if os.environ.get(v, "").strip()]
    started = time.time()
    with get_connection() as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_KEY,)).fetchone()[0]:
            log("lượt trước chưa xong — bỏ lượt này")
            return 0
        pages = {}
        for var, tok in tokens:
            try:
                j = call("/pages", tok, 0)
                for p in ((j.get("categorized") or {}).get("activated") or []):
                    if p.get("id") and str(p["id"]) not in pages:
                        pages[str(p["id"])] = (p, var, tok)
            except PancakeError as e:
                log(f"{var}: không đọc được danh sách page — {e}")
        if not pages:
            log("chưa có token Pancake đọc được page nào (Quản trị → Khoá kết nối)")
            purge(conn, int(cfg["retention_days"]))
            return 0
        codes = [v.get("shop_label") for v in rules["markets"].values() if isinstance(v, dict) and v.get("shop_label")]
        market_of = P.page_market_map([p for p, _v, _t in pages.values()], campaign_pages(conn, rules), codes)
        state = dict(conn.execute("SELECT page_id, synced_until FROM pancake_pages").fetchall())
        totals = [0, 0, 0]
        for pid, (p, var, tok) in pages.items():
            conn.execute(
                """INSERT INTO pancake_pages (page_id, name, platform, market, token_var, updated_at) VALUES (%s, %s, %s, %s, %s, now())
                   ON CONFLICT (page_id) DO UPDATE SET name = EXCLUDED.name, platform = EXCLUDED.platform,
                       market = EXCLUDED.market, token_var = EXCLUDED.token_var, updated_at = now()""",
                (pid, p.get("name") or "", p.get("platform"), market_of.get(pid), var))
            if time.time() - started > RUN_BUDGET_S:
                continue
            try:
                n_conv, n_msg, newest = sync_page(conn, pid, tok, cfg, state.get(pid))
                conn.execute("UPDATE pancake_pages SET synced_until = %s, last_sync_at = now(), last_error = NULL WHERE page_id = %s",
                             (newest, pid))
                totals[0] += 1
                totals[1] += n_conv
                totals[2] += n_msg
            except PancakeError as e:
                hint = " (tài khoản Pancake không có gói cước)" if str(e.code) == "121" else ""
                conn.execute("UPDATE pancake_pages SET last_sync_at = now(), last_error = %s WHERE page_id = %s",
                             (f"{e}{hint}"[:300], pid))
        purge(conn, int(cfg["retention_days"]))
        log(f"xong {totals[0]}/{len(pages)} page · {totals[1]} hội thoại có tin mới · {totals[2]} tin mới · {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
