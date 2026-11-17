"""Hộp thư Pancake — phần THUẦN (không mạng, không kho) của sync/talpha/pancake_inbox_sync.py. Có test.

Pancake (pages.fm/api/v1, token TÀI KHOẢN) trả hội thoại xếp theo updated_at mới nhất trước, lật bằng current_count;
giờ là UTC không ghi múi. Đo trên tài khoản có gói cước (17/11/2026):
  • hội thoại: from {id = mã Facebook, name}, customers [{id = mã khách PANCAKE, fb_id, name}], recent_phone_numbers;
  • tin: /pages/{page}/conversations/{id}/messages?customer_id=<mã khách PANCAKE> (thiếu / sai → 400 "Thiếu mã khách
    hàng"); lô đầu 25 tin mới nhất (cũ → mới), current_count lật lùi về tin cũ hơn, 30 tin một lô;
  • tin: message là HTML (<div>…), original_message là chữ trơn; ảnh = attachments [{type: photo, url, image_data}];
    attachments type system_message chỉ có chữ (message), không url.
Bộ đọc vẫn CHỊU nhiều tên khoá: thiếu trường nào thì để trống, không làm hỏng cả lượt.
"""
from __future__ import annotations

import datetime as dt
import html
import re
import unicodedata

UTC = dt.timezone.utc


def parse_ts(v) -> dt.datetime | None:
    """'2026-11-16T09:08:04.102000' (UTC không múi) / có Z / có +07:00 / số giây epoch → datetime có múi UTC."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(v / 1000 if v > 1e12 else v, tz=UTC)
    s = str(v).strip().replace("Z", "+00:00")
    try:
        t = dt.datetime.fromisoformat(s)
    except ValueError:
        return None
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)


def _first(*vals):
    return next((v for v in vals if v not in (None, "", [], {})), None)


def _name_id(obj) -> tuple:
    if isinstance(obj, dict):
        return _first(obj.get("name"), obj.get("full_name")), _first(obj.get("id"), obj.get("fb_id"), obj.get("psid"))
    return None, None


def phones_of(raw: dict) -> list:
    """Số điện thoại Pancake bắt được trong hội thoại: recent_phone_numbers [{phone_number}] / phone_numbers [chuỗi]."""
    out = []
    for key in ("recent_phone_numbers", "phone_numbers", "phones"):
        for x in raw.get(key) or []:
            p = x.get("phone_number") or x.get("captured") or x.get("phone") if isinstance(x, dict) else x
            p = re.sub(r"[^\d+]", "", str(p or ""))
            if len(p) >= 8 and p not in out:
                out.append(p)
    return out


def normalize_conversation(raw: dict) -> dict:
    """Một hội thoại Pancake → dòng pancake_conversations (trừ page_id)."""
    customers = raw.get("customers") or []
    name, cid = _name_id(raw.get("from"))
    if not name and customers:
        name, cid = _name_id(customers[0])
    if not name:
        name, cid2 = _name_id(raw.get("page_customer"))
        cid = cid or cid2
    last = raw.get("last_message") if isinstance(raw.get("last_message"), dict) else {}
    tags = [t.get("text") or t.get("id") if isinstance(t, dict) else t for t in (raw.get("tags") or [])]
    pancake_cid = next((c.get("id") for c in customers if isinstance(c, dict) and c.get("id")), None)
    return {
        "conversation_id": str(raw.get("id") or ""),
        "type": raw.get("type"),
        "customer_name": name,
        "customer_id": str(cid) if cid is not None else None,
        # Mã khách của PANCAKE (customers[].id, khác mã Facebook) — API tin nhắn bắt buộc có. Không lưu kho.
        "pancake_customer_id": str(pancake_cid) if pancake_cid is not None else None,
        "phone_numbers": phones_of(raw),
        "snippet": _first(raw.get("snippet"), last.get("message"), last.get("text")),
        "tags": [t for t in tags if t not in (None, "")],
        "inserted_at": parse_ts(raw.get("inserted_at")),
        "updated_at": parse_ts(_first(raw.get("updated_at"), raw.get("last_customer_interactive_at"), raw.get("inserted_at"))),
    }


_BREAK_RE = re.compile(r"<br\s*/?>|</(?:div|p|li)>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(s: str) -> str:
    """Tin dạng HTML của Pancake → chữ: hết khối / <br> là xuống dòng, bỏ thẻ, giải &amp;… , gộp dòng trống."""
    s = html.unescape(_TAG_RE.sub("", _BREAK_RE.sub("\n", s)))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(line.rstrip() for line in s.splitlines())).strip()


def _attachments(raw: dict) -> list:
    out = []
    for a in raw.get("attachments") or []:
        if not isinstance(a, dict) or a.get("type") == "system_message":
            continue
        payload = a.get("payload") if isinstance(a.get("payload"), dict) else {}
        image = a.get("image_data") if isinstance(a.get("image_data"), dict) else {}
        url = _first(a.get("url"), payload.get("url"), image.get("url"), a.get("file_url"), a.get("preview_url"))
        if url:
            out.append({"type": a.get("type") or a.get("mime_type") or "file", "url": str(url), "name": a.get("name")})
    return out


def normalize_message(raw: dict, page_id: str) -> dict:
    """Một tin Pancake → dòng pancake_messages (trừ page_id, conversation_id). Tin do page gửi: from.id = id page
    (hoặc cờ is_page / from_page)."""
    name, fid = _name_id(raw.get("from"))
    from_page = bool(raw.get("is_page") or raw.get("from_page") or (fid is not None and str(fid) == str(page_id)))
    plain = _first(raw.get("original_message"), raw.get("text"), raw.get("content"))
    body = str(plain).strip() if plain is not None else html_to_text(str(raw.get("message") or ""))
    if not body:                     # tin hệ thống (đổi người phụ trách, khách bấm nút…): chữ nằm trong attachments
        body = " · ".join(str(a.get("message")).strip() for a in raw.get("attachments") or []
                          if isinstance(a, dict) and a.get("type") == "system_message" and a.get("message"))
    return {
        "message_id": str(_first(raw.get("id"), raw.get("message_id")) or ""),
        "from_page": from_page,
        "sender_name": name,
        "body": body or None,
        "attachments": _attachments(raw),
        "sent_at": parse_ts(_first(raw.get("inserted_at"), raw.get("created_time"), raw.get("created_at"))),
    }


def batch_reaches(batch: list, floor: dt.datetime | None) -> bool:
    """Lô hội thoại (mới → cũ) đã chạm mốc `floor` (đã kéo tới đó / mốc kéo bù) — thôi lật trang."""
    if not batch:
        return True
    times = [c["updated_at"] for c in batch if c.get("updated_at")]
    return floor is not None and (not times or min(times) <= floor)


def normalize_page_name(s) -> str:
    """Như campaign_pages.normalize_page_name: bỏ chữ trang trí (𝑻𝒂𝒊𝒘𝒂𝒏 → taiwan), hoa thường, dấu câu."""
    s = unicodedata.normalize("NFKC", str(s or "")).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", s).split())


def page_market_map(pages: list, camp_pages: list, market_codes: list) -> dict:
    """Page → mã nước. camp_pages: [(tên page trong tên camp, mã nước của camp)] — khớp tên page là chính, nhiều nước
    thì lấy nước nhiều camp nhất. Không có camp: tên page kết thúc bằng đúng mã nước ('… JP', '… - TW'). Không gán
    được → không có trong kết quả (chỉ giám đốc xem)."""
    votes: dict = {}
    for page_name, code in camp_pages:
        k = normalize_page_name(page_name)
        if k and code:
            votes.setdefault(k, {}).setdefault(code, 0)
            votes[k][code] += 1
    out = {}
    for p in pages:
        k = normalize_page_name(p.get("name"))
        if k in votes:
            out[str(p["id"])] = max(votes[k].items(), key=lambda kv: kv[1])[0]
            continue
        last = k.split(" ")[-1].upper() if k else ""
        if last in market_codes:
            out[str(p["id"])] = last
    return out
