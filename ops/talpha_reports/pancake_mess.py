"""Tin nhắn theo PAGE từ Pancake — cho nước Meta KHÔNG báo số tin nhắn (Nhật, 09/10/2026).

Quảng cáo chạy ở Nhật không có chỉ số tin nhắn trên Meta (luật bảo vệ thông tin liên lạc của
Nhật): camp Nhật là camp tin nhắn mà fb_ads_data.messaging_conversations_started = 0, nên cột
SỐ TIN NHẮN, Giá Tiền/TN, Tỷ lệ chốt của Nhật trên Sheet đều sai. format_all.py gọi module này để
lấy số thật từ hộp thư Pancake rồi gán vào ô (marketer, nước, tab page, ngày) của camp chạy page đó.

Cùng cách đếm với bot Zalo (dashboard-ui/src/lib/talpha/pancake.ts, đo API 09/10/2026):
  • https://pages.fm/api/v1 + access_token TÀI KHOẢN Pancake (TALPHA_PANCAKE_API_TOKEN, ~90 ngày);
  • /pages → categorized.activated · /pages/{id}/conversations lật bằng current_count (page_number bị
    bỏ qua), xếp theo updated_at giảm dần — hết lô khi cả lô cập nhật trước mốc;
  • tin nhắn mới trong ngày = hội thoại INBOX có inserted_at (UTC không múi, +7 ra giờ VN) rơi vào ngày đó;
  • hội thoại không ghi đến từ quảng cáo nào → gom theo PAGE, nối camp bằng ô tên page trong tên camp.
Hỏng (thiếu token, token hết hạn, Pancake lỗi) → trả None, format_all giữ số Meta và in CANH BAO.
"""
import datetime
import json
import os
import time
import unicodedata
import re
import urllib.error
import urllib.parse
import urllib.request

API = "https://pages.fm/api/v1"
PANCAKE_TOKEN_VARS = ("TALPHA_PANCAKE_API_TOKEN", "TALPHA_PANCAKE_API_TOKEN_2", "TALPHA_PANCAKE_API_TOKEN_3")
CALL_INTERVAL = 0.4          # giây giữa hai lượt gọi — gọi dồn là 429
VN = datetime.timedelta(hours=7)


def normalize_page_name(s):
    """≡ talpha_rules.normalize_page_name (chép để module chạy độc lập trong test)."""
    s = unicodedata.normalize("NFKC", str(s or "")).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", s).split())


def _utc(iso):
    s = str(iso or "").strip()[:19]
    try:
        return datetime.datetime.fromisoformat(s)
    except ValueError:
        return None


def vn_date(iso):
    t = _utc(iso)
    return (t + VN).date().isoformat() if t else None


def count_by_date(conversations, from_date, to_date):
    """[hội thoại] → {ngày VN: số tin nhắn MỚI (INBOX)} trong [tu_ngay, toi_ngay]; trùng id một lần."""
    out, seen_ids = {}, set()
    for h in conversations:
        if not h or h.get("id") in seen_ids:
            continue
        seen_ids.add(h.get("id"))
        if str(h.get("type") or "").upper() == "COMMENT":
            continue
        d = vn_date(h.get("inserted_at"))
        if d and from_date <= d <= to_date:
            out[d] = out.get(d, 0) + 1
    return out


def is_batch_exhausted(batch, from_date):
    """Cả lô đã cập nhật trước 00:00 VN của tu_ngay → các lô sau không còn hội thoại tạo từ ngày đó."""
    if not batch:
        return True
    cutoff = datetime.datetime.fromisoformat(from_date) - VN       # 00:00 VN tính theo UTC
    for h in batch:
        t = _utc(h.get("updated_at") or h.get("inserted_at"))
        if t is None or t >= cutoff:
            return False
    return True


def is_market_page(name, market_code):
    """Từ CUỐI tên page là mã nước ("Lucky Charm JP"). Chỉ mã shop: "Prime Leather Japan" là page Đài."""
    words = normalize_page_name(name).upper().split()
    return bool(words) and words[-1] == str(market_code).upper()


def _call(url, log):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:  # nosec B310 — URL Pancake API cố định (https)
                j = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * 2 ** attempt)
                continue
            raise RuntimeError(f"Pancake HTTP {e.code}")
        if j.get("success") is False:
            raise RuntimeError(f"Pancake: {j.get('message') or 'lỗi'} (mã {j.get('error_code')})")
        return j
    raise RuntimeError("Pancake 429 — gọi dồn quá")


def token_expiry(tok):
    try:
        p = tok.split(".")[1]
        p += "=" * (-len(p) % 4)
        import base64
        return json.loads(base64.urlsafe_b64decode(p)).get("exp")
    except Exception:            # noqa: BLE001
        return None


def messages_by_page(camp_page_names, market_code, from_date, to_date, log=print, token=None):
    """Số tin nhắn mới theo page × ngày cho MỘT nước.

    ten_trang_camp: tên page lấy từ ô page của các camp nước đó (khớp chính).
    Trả {tên page chuẩn hoá: {"ten": tên trên Pancake, "ngay": {ngày: số}}} hoặc None nếu hỏng.
    """
    # Nhiều tài khoản Pancake (17/11/2026): TALPHA_PANCAKE_API_TOKEN, _2, _3 — page của mọi token, trùng thì token đầu thắng.
    toks = [token] if token else [os.environ.get(v, "").strip() for v in PANCAKE_TOKEN_VARS]
    toks = [t for t in toks if t]
    if not toks:
        log("CANH BAO: chua khai TALPHA_PANCAKE_API_TOKEN — tin nhan Nhat giu so Meta (0)")
        return None
    alive = [t for t in toks if not (token_expiry(t) and token_expiry(t) < time.time())]
    if not alive:
        log(f"CANH BAO: token Pancake het han {datetime.date.fromtimestamp(token_expiry(toks[0]))} — tin nhan Nhat giu so Meta (0)")
        return None
    wanted = {normalize_page_name(t) for t in camp_page_names if t}
    try:
        pages, token_of = [], {}
        for tok in alive:
            try:
                c = _call(f"{API}/pages?access_token={urllib.parse.quote(tok)}", log).get("categorized") or {}
            except RuntimeError as e:
                log(f"CANH BAO: mot token Pancake khong doc duoc danh sach page ({e})")
                continue
            for p in (c.get("activated") or []) + (c.get("inactivated") or []):
                if p and p.get("id") and p["id"] not in token_of:
                    token_of[p["id"]] = tok
                    pages.append(p)
        selected = [p for p in pages if normalize_page_name(p.get("name")) in wanted or is_market_page(p.get("name"), market_code)]
        out = {}
        for p in selected:
            all_conversations, cc = [], 0
            try:
                for _ in range(60):
                    time.sleep(CALL_INTERVAL)
                    batch = _call(f"{API}/pages/{p['id']}/conversations?access_token={urllib.parse.quote(token_of[p['id']])}&current_count={cc}", log).get("conversations") or []
                    all_conversations += batch
                    if is_batch_exhausted(batch, from_date):
                        break
                    cc += len(batch)
            except RuntimeError as e:
                # Page chưa chạy camp nào mà lỗi (chưa có gói cước…) thì thôi; page có camp thì báo.
                if normalize_page_name(p.get("name")) in wanted:
                    log(f"CANH BAO: Pancake page {p.get('name')}: {e}")
                continue
            out[normalize_page_name(p.get("name"))] = {"ten": p.get("name"), "ngay": count_by_date(all_conversations, from_date, to_date)}
        seen = {normalize_page_name(p.get("name")) for p in pages}
        for k in wanted - seen:
            log(f"CANH BAO: tai khoan Pancake khong thay page '{k}' cua camp {market_code} — tin nhan page do = 0")
        return out
    except Exception as e:       # noqa: BLE001
        log(f"CANH BAO: Pancake loi ({e}) — tin nhan Nhat giu so Meta (0)")
        return None


def assign_to_campaigns(page_counts, ad_rows, is_market_camp, camp_page):
    """Gán tin nhắn (page × ngày) cho MỘT camp: camp TIÊU NHIỀU NHẤT trên page đó trong ngày đó; ngày
    page không tiêu đồng nào (khách nhắn muộn) → camp gần nhất trước đó chạy page đó.

    dong_ads: [(campaign_name, ngày 'YYYY-MM-DD', tiền)] — đủ rộng (cả tháng + trước đó).
    Trả ({(campaign_name, ngày): số tin nhắn}, {tên page: số tin nhắn KHÔNG gán được}).
    """
    by_page = {}
    for cn, d, spend in ad_rows:
        if not is_market_camp(cn):
            continue
        t = camp_page(cn)
        if not t:
            continue
        by_page.setdefault(normalize_page_name(t), []).append((d, float(spend or 0), cn))
    assigned, unassigned = {}, {}
    for k, v in (page_counts or {}).items():
        ds = sorted(by_page.get(k, []))
        for d, n in v["ngay"].items():
            if not n:
                continue
            same_day = [x for x in ds if x[0] == d]
            if same_day:
                cn = max(same_day, key=lambda x: x[1])[2]
            else:
                earlier = [x for x in ds if x[0] < d]
                cn = earlier[-1][2] if earlier else (ds[0][2] if ds else None)
            if cn is None:
                unassigned[v["ten"]] = unassigned.get(v["ten"], 0) + n
                continue
            assigned[(cn, d)] = assigned.get((cn, d), 0) + n
    return assigned, unassigned
