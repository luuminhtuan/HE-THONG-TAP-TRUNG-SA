"""Kéo hộp thư Pancake vào Postgres — mỗi pancake_inbox.sync_every_minutes phút (30), và khi người dùng bấm "Tải tin
mới" ở tab Tin nhắn.

Cho tab Tin nhắn (17/11/2026): dashboard XEM từ bảng pancake_* (migration 0004), không gọi Pancake lúc xem.
Mỗi lượt, với mỗi page các token Pancake thấy (TALPHA_PANCAKE_API_TOKEN, _2, _3 — trùng page thì thử lần lượt, token
không có gói cước cho page đó (mã 121) thì sang token sau):
  1. lật hội thoại (mới → cũ) tới khi chạm mốc đã kéo (pancake_pages.synced_until) — lần đầu: backfill_days ngày;
  2. hội thoại có tin mới: kéo tin, ghi thêm (trùng id thì bỏ) — mỗi hội thoại một transaction, dừng giữa chừng không mất;
     một hội thoại lỗi lẻ (400 / 404) thì bỏ qua — khách nhắn tiếp là hội thoại đổi giờ, lượt sau kéo bù;
  3. page xong hết mới dời mốc synced_until — lượt sau làm lại phần dở, không sót.
Cuối lượt xoá tin / hội thoại cũ hơn retention_days. Hai lượt không chồng nhau (advisory lock).

Sổ lượt + nút "Tải tin mới" (migration 0007, bảng pancake_sync_runs): dashboard ghi dòng 'pending'; lượt nào chạy cũng
nhận hết dòng đang chờ, chạy xong ghi kết quả. Máy chủ VPS gọi script MỖI PHÚT với --if-due: không có yêu cầu bấm tay
và chưa tới lượt (sync_every_minutes) thì thoát ngay, không gọi Pancake. Docker: lịch gọi --if-due 5 phút một lần + nhặt
yêu cầu mỗi 15 giây (ops/docker/scheduler.py).
Luật: talpha_rules.json → pancake_inbox. Phần thuần (đọc dữ liệu Pancake, gán page → nước): sync/core/pancake_inbox.py.

    python sync/talpha/pancake_inbox_sync.py            # chạy một lượt ngay
    python sync/talpha/pancake_inbox_sync.py --if-due   # chỉ chạy khi có người bấm / tới lượt
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)
from sync.core import pancake_inbox as P  # noqa: E402
from sync.core.credentials import load_credentials_to_env  # noqa: E402
from sync.core.market_config import load_rules  # noqa: E402
from sync.core.pg import get_connection  # noqa: E402

API = "https://pages.fm/api/v1"
TOKEN_VARS = ("TALPHA_PANCAKE_API_TOKEN", "TALPHA_PANCAKE_API_TOKEN_2", "TALPHA_PANCAKE_API_TOKEN_3")
LOCK_KEY = 7_311_017          # pg_try_advisory_lock — một lượt một lúc
RUN_BUDGET_S = 240            # lượt chạy quá 4 phút thì dừng (cả giữa một page) — lượt sau làm nốt


class PancakeError(RuntimeError):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


VN = ZoneInfo("Asia/Ho_Chi_Minh")
NO_PLAN = "121"               # mã Pancake: page không nằm trong gói cước của tài khoản (token) này
NO_ACCESS = "105"             # mã Pancake: token không có quyền với page ("Không có quyền hạn trên trang này")
TOKEN_ERRORS = (NO_PLAN, NO_ACCESS)   # lỗi theo TOKEN — page đó thử token sau


def log(*a):
    print(datetime.now(VN).strftime("%F %T"), "[pancake]", *a, flush=True)


def call(path, tok, interval_s, **params):
    """GET Pancake → JSON. 429 → chờ 5 · 10 · 20 · 40s; 5xx (Pancake chập chờn — đo 17/11/2026: 13 page cùng 500 trong
    vài phút) → chờ 3 · 6s, gọi lại tối đa 2 lần. success=false → PancakeError (121 không gói cước, 105 không quyền)."""
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
            if e.code >= 500 and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            try:                                            # Pancake ghi lý do trong thân: {"message": "Thiếu mã khách hàng"}
                why = str(json.loads(e.read().decode("utf-8", "replace")).get("message") or "")[:150]
            except Exception:  # noqa: BLE001
                why = ""
            raise PancakeError(f"HTTP {e.code}" + (f" — {why}" if why else ""), e.code) from None
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
                 cfg["call_interval_ms"] / 1000, customer_id=c["pancake_customer_id"], **({"current_count": cc} if cc else {}))
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


# Lỗi của RIÊNG một hội thoại (thiếu / sai mã khách, hội thoại đã xoá; 5xx sau khi đã gọi lại) — bỏ qua hội thoại đó,
# page chạy tiếp (khách nhắn tiếp là hội thoại đổi giờ, lượt sau kéo bù). SERVER_STREAK hội thoại liền nhau 5xx = Pancake
# sập → dừng page, KHÔNG dời mốc. Lỗi khác (121, 105, token hết hạn, 429 mãi) → dừng page, không dời mốc.
CONVERSATION_ERRORS = (400, 404)
SERVER_STREAK = 3


def sync_page(conn, page_id, tok, cfg, synced_until, deadline):
    """Hội thoại mới hơn mốc + tin của chúng, cũ trước. Quá `deadline` thì dừng — mốc dời tới hội thoại cuối đã xong,
    lượt sau làm nốt. Trả (số hội thoại đã xong, số tin mới, mốc mới, [lỗi hội thoại lẻ], xong hết chưa)."""
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
    added, skipped, done, newest, streak = 0, [], 0, synced_until, 0
    for c in changed:
        if time.time() > deadline:
            return done, added, newest, skipped, False
        upsert_conversation(conn, page_id, c)
        if c["pancake_customer_id"]:
            try:
                added += sync_messages(conn, page_id, c, tok, cfg)
                streak = 0
            except PancakeError as e:
                server = isinstance(e.code, int) and e.code >= 500
                streak = streak + 1 if server else 0
                if (e.code not in CONVERSATION_ERRORS and not server) or streak >= SERVER_STREAK:
                    raise
                skipped.append(str(e))
        else:
            skipped.append("hội thoại thiếu mã khách Pancake")
        done, newest = done + 1, c["updated_at"]
    # Không có hội thoại mới thì mốc là `floor` — lượt sau khỏi lật lại backfill_days ngày.
    return done, added, newest or floor, skipped, True


def purge(conn, days):
    with conn.transaction():
        m = conn.execute("DELETE FROM pancake_messages WHERE sent_at < now() - make_interval(days => %s)", (days,)).rowcount
        c = conn.execute("""DELETE FROM pancake_conversations WHERE updated_at < now() - make_interval(days => %s)""", (days,)).rowcount
        conn.execute("DELETE FROM pancake_sync_runs WHERE requested_at < now() - interval '30 days'")
    if m or c:
        log(f"xoá {c} hội thoại, {m} tin cũ hơn {days} ngày")


def claim_runs(conn, if_due: bool, every_minutes) -> list | None:
    """Đang giữ khoá nên dòng 'running' nào còn là của lượt đã chết giữa chừng → 'failed'. Nhận MỌI yêu cầu bấm tay
    đang chờ; không có thì: --if-due chưa tới lượt → None (thoát), còn lại ghi một dòng lượt theo lịch. Trả id các dòng."""
    with conn.transaction():
        conn.execute("""UPDATE pancake_sync_runs SET status = 'failed', finished_at = now(),
                               summary = COALESCE(summary || ' · ', '') || 'lượt bị ngắt giữa chừng' WHERE status = 'running'""")
        ids = [r[0] for r in conn.execute("""UPDATE pancake_sync_runs SET status = 'running', started_at = now()
                                              WHERE status = 'pending' RETURNING id""").fetchall()]
        if ids:
            return ids
        if if_due:
            last = conn.execute("SELECT max(started_at) FROM pancake_sync_runs WHERE started_at IS NOT NULL").fetchone()[0]
            # Trừ 30 giây: timer lệch vài giây — đừng để lượt 30 phút trượt sang phút / lượt lịch kế tiếp.
            if last and (datetime.now(timezone.utc) - last).total_seconds() < float(every_minutes) * 60 - 30:
                return None
        return [conn.execute("""INSERT INTO pancake_sync_runs (trigger, status, started_at) VALUES ('schedule', 'running', now())
                                RETURNING id""").fetchone()[0]]


def finish_runs(conn, ids: list, ok: bool, summary: str) -> None:
    conn.execute("UPDATE pancake_sync_runs SET status = %s, finished_at = now(), summary = %s WHERE id = ANY(%s)",
                 ("ok" if ok else "failed", summary[:500], ids))


def save_page(conn, pid, name, platform, market, token_var, synced=False, synced_until=None, error=None, keep_mark=False,
              error_code=None):
    """Ghi / cập nhật một page. synced=False: chỉ tên + nước (page chưa tới lượt / ngoài gói chưa tới giờ hỏi lại).
    keep_mark: lượt lỗi — giữ mốc cũ."""
    conn.execute(
        """INSERT INTO pancake_pages (page_id, name, platform, market, token_var, synced_until, last_sync_at, last_error,
                                      last_error_code, updated_at)
           VALUES (%(pid)s, %(name)s, %(platform)s, %(market)s, %(var)s, %(until)s,
                   CASE WHEN %(synced)s THEN now() END, %(error)s, %(code)s, now())
           ON CONFLICT (page_id) DO UPDATE SET name = EXCLUDED.name, platform = EXCLUDED.platform, market = EXCLUDED.market,
               token_var = EXCLUDED.token_var, updated_at = now(),
               synced_until = CASE WHEN %(synced)s AND NOT %(keep)s THEN EXCLUDED.synced_until ELSE pancake_pages.synced_until END,
               last_sync_at = CASE WHEN %(synced)s THEN now() ELSE pancake_pages.last_sync_at END,
               last_error = CASE WHEN %(synced)s THEN EXCLUDED.last_error ELSE pancake_pages.last_error END,
               last_error_code = CASE WHEN %(synced)s THEN EXCLUDED.last_error_code ELSE pancake_pages.last_error_code END""",
        {"pid": pid, "name": name, "platform": platform, "market": market, "var": token_var, "until": synced_until,
         "synced": synced, "error": error, "keep": keep_mark, "code": error_code})


def sync_all(conn, rules, cfg, tokens, started) -> str:
    """Một lượt kéo mọi page. Trả câu tóm tắt (ghi sổ lượt + log)."""
    pages: dict = {}                 # page_id → (page, [(biến token, token)…]) — token đầu thấy page đứng trước
    for var, tok in tokens:
        try:
            j = call("/pages", tok, 0)
            for p in ((j.get("categorized") or {}).get("activated") or []):
                if p.get("id"):
                    pages.setdefault(str(p["id"]), (p, []))[1].append((var, tok))
        except PancakeError as e:
            log(f"{var}: không đọc được danh sách page — {e}")
    if not pages:
        return "chưa có token Pancake đọc được page nào (Quản trị → Khoá kết nối)"
    codes = [v.get("shop_label") for v in rules["markets"].values() if isinstance(v, dict) and v.get("shop_label")]
    market_of = P.page_market_map([p for p, _c in pages.values()], campaign_pages(conn, rules), codes)
    state = {r[0]: r[1:] for r in conn.execute(
        "SELECT page_id, synced_until, last_error_code, last_sync_at FROM pancake_pages").fetchall()}
    recheck_after = datetime.now(timezone.utc) - timedelta(minutes=int(cfg.get("no_plan_recheck_minutes", 60)))
    ok_pages, n_conv, n_msg, failed, cut, no_plan = 0, 0, 0, 0, 0, 0
    for pid, (p, cands) in pages.items():
        info = (pid, p.get("name") or "", p.get("platform"), market_of.get(pid))
        synced_until, code, last_try = state.get(pid, (None, None, None))
        if code == NO_PLAN and last_try and last_try > recheck_after:
            save_page(conn, *info, cands[0][0])         # ngoài gói cước, vừa hỏi chưa lâu — khỏi gọi Pancake
            no_plan += 1
            continue
        if time.time() - started > RUN_BUDGET_S:
            save_page(conn, *info, cands[0][0])         # vẫn ghi tên / nước — page mới hiện ngay, lượt sau kéo tin
            cut += 1
            continue
        done, err, err_code, used = False, None, None, cands[0][0]
        for var, tok in cands:
            used = var
            try:
                c_, m_, newest, skipped, whole = sync_page(conn, pid, tok, cfg, synced_until, started + RUN_BUDGET_S)
            except PancakeError as e:
                err_code = str(e.code) if e.code is not None else None
                err = f"{e}" + (" (page không nằm trong gói cước của token nào)" if err_code == NO_PLAN else "")
                if err_code in TOKEN_ERRORS:
                    continue             # gói cước / quyền tính theo page của từng tài khoản — token sau có thể có
                break                    # lỗi khác thì token nào cũng vậy
            err = f"{len(skipped)} hội thoại không kéo được tin: {skipped[0]}" if skipped else None
            save_page(conn, *info, var, synced=True, synced_until=newest, error=err)
            ok_pages, n_conv, n_msg, done = ok_pages + int(whole), n_conv + c_, n_msg + m_, True
            cut += int(not whole)
            break
        if not done:
            save_page(conn, *info, used, synced=True, error=(err or "lỗi")[:300], keep_mark=True, error_code=err_code)
            if err_code == NO_PLAN:
                no_plan += 1
            else:
                failed += 1
    parts = [f"{ok_pages}/{len(pages)} page", f"{n_conv} hội thoại có tin mới", f"{n_msg} tin mới"]
    if no_plan:
        parts.append(f"{no_plan} page ngoài gói cước")
    if failed:
        parts.append(f"{failed} page lỗi")
    if cut:
        parts.append(f"{cut} page còn dở — lượt sau làm nốt (một lượt tối đa {RUN_BUDGET_S // 60} phút)")
    return " · ".join(parts)


def main(argv=None) -> int:
    if_due = "--if-due" in (argv if argv is not None else sys.argv[1:])
    load_credentials_to_env()
    rules = load_rules()
    cfg = rules["pancake_inbox"]
    tokens = [(v, os.environ.get(v, "").strip()) for v in TOKEN_VARS if os.environ.get(v, "").strip()]
    started = time.time()
    with get_connection() as conn:
        if not conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_KEY,)).fetchone()[0]:
            if not if_due:
                log("lượt trước chưa xong — bỏ lượt này")
            return 0
        run_ids = claim_runs(conn, if_due, cfg["sync_every_minutes"])
        if run_ids is None:
            return 0                                    # --if-due: chưa tới lượt, không ai bấm
        try:
            summary = sync_all(conn, rules, cfg, tokens, started)
            purge(conn, int(cfg["retention_days"]))
        except Exception as e:
            finish_runs(conn, run_ids, False, f"lỗi: {e}")
            raise
        summary = f"{summary} · {time.time() - started:.0f}s"
        finish_runs(conn, run_ids, True, summary)
        log(f"xong {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
