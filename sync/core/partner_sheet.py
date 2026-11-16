"""
Bảng đơn của đối tác 3PL (Google Sheet) → dòng cho bảng Postgres `partner_orders`.

Vì sao cần: POS chỉ biết đơn đã CHỐT; bảng của đối tác mới có mã vận đơn, ngày xuất kho,
trạng thái giao và tiền COD đối tác thu. Tab Theo dõi vận đơn / Sổ đơn hàng đọc thẳng bảng
Đài (tracking.partner_file) mà không lưu vào kho số — có bảng trong kho số thì muốn tra,
đối chiếu với POS hay dựng báo cáo lúc nào cũng được, kể cả khi đối tác sửa/xoá dòng.
Sỹ Anh chia sẻ bảng Singapore 25/09/2026 ("cập nhật vào database cho những lúc cần").

Module này KHÔNG ghi kho số — chỉ đọc Sheet và chuẩn hoá dòng. Ghi là việc của
talpha_sync.sync_partner_orders() (pg_writer.replace_table — thay cả bảng trong một transaction).
Cấu hình (sheet nào, tên cột nào) ở config/talpha_rules.json → partner_orders.

Hai cách đọc (05/11/2026): có khoá Google (GOOGLE_APPLICATION_CREDENTIALS) thì đọc bằng Sheets API — bảng
để riêng tư, share cho tài khoản dịch vụ; không có khoá thì đọc qua link xuất CSV như bảng NAZA của Đài
(dashboard-ui/src/lib/talpha/sheet-source.ts) — chỉ được khi bảng để "ai có link đều xem được".
"""
import csv
import io
import os
import re
import logging
import unicodedata
from datetime import date

import requests

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def normalize_header(s) -> str:
    """'COD Amount (SGD)' → 'cod amount sgd' · 'Mã đơn mới…' → 'ma don moi…' · 'Contact Name(*)' → 'contact name'."""
    s = unicodedata.normalize("NFKD", str(s or "")).replace("đ", "d").replace("Đ", "D")
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def map_columns(headers: list, column_map: dict) -> dict:
    """Tiêu đề → {khoá: chỉ số cột}. Mỗi tiêu đề nhận khoá có bí danh KHỚP DÀI NHẤT —
    'ma don moi cua don di kho hang hoan' phải về return_order_no ('ma don moi') chứ không
    về order_no ('ma don'). Mỗi khoá chỉ lấy cột đầu tiên khớp."""
    result = {}
    for i, td in enumerate(headers):
        h = normalize_header(td)
        if not h:
            continue
        best, best_len = None, -1
        for key, aliases in column_map.items():
            if key.startswith("_"):
                continue
            for b in aliases:
                b = normalize_header(b)
                if b and (h == b or h.startswith(b + " ")) and len(b) > best_len:
                    best, best_len = key, len(b)
        if best and best not in result:
            result[best] = i
    return result


def parse_date(v):
    """'14/9/2026' · '18/09/2026' · '2026-09-14' → 'YYYY-MM-DD'; không đọc được → None."""
    s = str(v or "").strip()
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    try:
        if m:
            return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
        m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
        if m:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
    except ValueError:
        return None
    return None


def parse_number(v):
    """'99' · '1,299' · '1.299,5' · '' → số hoặc None. Sheet vi_VN dùng chấm nghìn, phẩy thập phân."""
    s = re.sub(r"[^\d,.\-]", "", str(v or ""))
    if not s:
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", "." if len(s.split(",")[-1]) != 3 else "")
    try:
        return float(s)
    except ValueError:
        return None


def normalize_rows(values: list, column_map: dict, meta: dict, synced_at: str) -> list:
    """values = mảng 2 chiều (dòng 1 là tiêu đề) → list dict theo PARTNER_ORDER_SCHEMA.
    meta = {market, shop_label, sheet_id}. Dòng không có cả mã đơn lẫn mã vận đơn bị bỏ."""
    if not values:
        return []
    columns = map_columns(values[0], column_map)
    missing = [k for k in ("order_no", "tracking", "cod") if k not in columns]
    if missing:
        raise ValueError(f"bảng {meta.get('sheet_id')} thiếu cột {missing} — tiêu đề: {values[0]}")

    def o(r, k):
        i = columns.get(k)
        return str(r[i]).strip() if i is not None and i < len(r) and r[i] is not None else ""

    result = []
    for row_no, r in enumerate(values[1:], start=2):
        order_no, tracking = o(r, "order_no"), re.sub(r"\s+", "", o(r, "tracking"))
        if not order_no and not tracking:
            continue
        qty = parse_number(o(r, "quantity"))
        result.append({
            "market": meta["market"], "shop_label": meta["shop_label"], "sheet_id": meta["sheet_id"],
            "row_no": row_no,
            "marketer": o(r, "marketer"), "recon": o(r, "recon"), "note": o(r, "note"),
            "status": o(r, "status"),
            "order_date": parse_date(o(r, "order_date")), "ship_date": parse_date(o(r, "ship_date")),
            "ship_method": o(r, "ship_method"),
            "order_no": order_no, "tracking": tracking,
            "return_order_no": re.sub(r"\s+", "", o(r, "return_order_no")),
            "sku": o(r, "sku"), "quantity": int(qty) if qty is not None else None,
            "contact_name": o(r, "contact_name"), "phone": o(r, "phone"),
            "country": o(r, "country"), "state": o(r, "state"), "city": o(r, "city"),
            "address": o(r, "address"), "postcode": o(r, "postcode"),
            "cod": parse_number(o(r, "cod")), "currency": o(r, "currency"),
            "synced_at": synced_at,
        })
    return result


def read_public_sheet(sheet_id: str, gid: str = "0") -> list:
    """Đọc tab qua link xuất CSV, KHÔNG cần khoá — cùng cách dashboard đọc bảng NAZA của Đài. Bảng để
    riêng tư thì Google trả 401 / trang đăng nhập → báo lỗi rõ, không trả bảng rỗng (rỗng là xoá trắng
    partner_orders)."""
    r = requests.get(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export",
                     params={"format": "csv", "gid": gid}, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
    if r.status_code in (401, 403) or "csv" not in r.headers.get("Content-Type", ""):
        raise RuntimeError(f"bảng {sheet_id} để riêng tư (HTTP {r.status_code}) — cần khoá Google, hoặc chủ bảng "
                           f"bật 'ai có link đều xem được' như bảng NAZA của Đài")
    r.raise_for_status()
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    # Sheets API bỏ ô trống cuối dòng và dòng trống cuối bảng — làm y vậy để chuan_dong nhận như nhau.
    rows = [list(row) for row in rows]
    for row in rows:
        while row and row[-1] == "":
            row.pop()
    while rows and not rows[-1]:
        rows.pop()
    return rows


def read_sheet(sheet_id: str, gid: str = "0") -> list:
    """Đọc cả tab (theo gid). Có khoá Google thì đọc bằng tài khoản dịch vụ trong
    GOOGLE_APPLICATION_CREDENTIALS (bảng CHIA SẺ quyền Người xem cho email tài khoản đó, không cần công
    khai); không có khoá thì đọc qua link công khai (doc_sheet_cong_khai)."""
    if not os.path.isfile(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or ""):
        return read_public_sheet(sheet_id, gid)
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    creds, _ = google.auth.default(scopes=SCOPES)
    s = AuthorizedSession(creds)
    base = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
    meta = s.get(base, params={"fields": "sheets.properties(title,sheetId)"}, timeout=60)
    meta.raise_for_status()
    tabs = {str(t["properties"]["sheetId"]): t["properties"]["title"] for t in meta.json().get("sheets", [])}
    tab_title = tabs.get(str(gid))
    if tab_title is None:
        raise ValueError(f"bảng {sheet_id} không có tab gid={gid} (có: {tabs})")
    r = s.get(f"{base}/values/'{tab_title}'!A1:AZ", params={"valueRenderOption": "FORMATTED_VALUE"}, timeout=60)
    r.raise_for_status()
    return r.json().get("values", [])
