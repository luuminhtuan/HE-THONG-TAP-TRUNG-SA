"""
sync/core/pg_writer.py — ghi số vào Postgres (04/11/2026, thay bq_writer của thời BigQuery).

Cơ chế hai tầng (X1/X2): <bảng>_raw chỉ GHI THÊM, mọi phiên bản đơn / dòng quảng cáo từng thấy, không
bao giờ xoá; bảng sạch dựng lại từ raw mỗi vòng = bản mới nhất của mỗi khoá. Kéo hụt chỉ làm đơn đó giữ
bản cũ, không xoá được số đã có. Lý do ra đời: WRITE_TRUNCATE cả bảng đặt cược mọi thứ vào việc lần kéo
này phải đủ — 04/08 sale_order tụt 4.440 → 3.960 trong 1 giờ; tháng 7/2026 mất sạch spend vì cửa sổ
ngày 1 co về 1 ngày.

Ghi raw + dựng lại bảng sạch nằm trong MỘT transaction. Lỗi giữa chừng là mọi thứ quay về như trước
vòng chạy; người đang đọc thấy bảng cũ cho tới lúc COMMIT. Bước "DELETE bảng sạch rồi INSERT lại" vì
thế an toàn — khác hẳn pattern drop-trước-khi-fetch đã bị cấm.

Cột lấy từ bảng thật (information_schema): dòng mang cột bảng chưa có thì báo lỗi rõ "thêm
migration", không lặng lẽ bỏ cột.
"""
import json
import logging
import re

log = logging.getLogger(__name__)


# ═══ Luật chọn đơn (thuần, có test) ═══════════════════════════════════════════════════════

def _loc_shop(shop_ids, cot: str) -> str:
    """Mệnh đề WHERE giữ đúng các shop đang khai. Rỗng/thiếu mã shop → không lọc.

    Mã shop POS là dãy số; nhận thứ khác là từ chối luôn, vì chuỗi này ghép thẳng vào SQL.
    """
    ids = [str(s).strip() for s in (shop_ids or [])]
    if not ids or any(not s for s in ids):
        return ""
    for s in ids:
        if not s.isdigit():
            raise ValueError(f"shop_id phải là dãy số, nhận {s!r}")
    return f"WHERE {cot} IN (" + ", ".join(f"'{s}'" for s in ids) + ")"


# Đơn bị XOÁ trên POS (17/09/2026: 10 đơn Singapore #59–#81 — ngày 14/09 Sheet ra 6 đơn, POS thật 3).
# Raw chỉ ghi thêm, nên đơn đã xoá cứ nằm lại mãi ở bản cuối cùng từng thấy. Vòng sync nào kéo ĐỦ
# cửa sổ của một shop mà không còn thấy đơn đó thì nối vào raw một dòng "bia mộ": y bản cuối, trạng
# thái = dấu này, sync_time mới hơn → thắng khi dựng lại → bảng sạch bỏ đơn đó. Raw vẫn giữ nguyên
# lịch sử. Đơn hiện lại trên POS thì vòng sau nối bản mới → sống lại.
DA_XOA_TREN_POS = "__da_xoa_tren_pos__"

# Cột thêm SAU khi bảng đơn đã có dữ liệu (17/09/2026: tên page + sale). Đơn cũ không đổi
# `updated_at` thì không bao giờ được nối lại → mãi mang NULL ở cột mới. Vòng sync nào thấy
# POS đã có giá trị mà bảng còn trống thì nối lại đơn đó MỘT lần — tự lành.
COT_DIEN_NGUOC = ("page_name", "seller_name")


def chon_don_can_ghi(orders, known, thieu_cot=False, trong=None, cot=COT_DIEN_NGUOC):
    """Đơn phải nối vào raw:
      · đơn mới, hoặc `updated_at` mới hơn bản đang có;
      · bảng sạch CHƯA có cột mới (thieu_cot) → mọi đơn trong cửa sổ, để điền ngược;
      · bảng đang TRỐNG cột mới ở đơn đó (trong[cột] chứa khoá) mà POS đã có giá trị.
    known: {"shop_id|id": updated_at} · trong: {tên cột: {"shop_id|id", …}}."""
    trong = trong or {}
    out = []
    for o in orders:
        k = f"{o.get('shop_id', '')}|{o.get('id', '')}"
        if (thieu_cot
                or str(o.get("updated_at", "")) > known.get(k, "")
                or any(o.get(c) and k in trong.get(c, ()) for c in cot)):
            out.append(o)
    return out


def chon_don_da_xoa(trong_bang, da_thay, toi_thieu=20, ty_le=0.3):
    """Đơn bị XOÁ trên POS: đang có trong bảng sạch, thuộc cửa sổ vừa kéo ĐỦ của shop, mà POS
    không trả về nữa.
    trong_bang: [(shop_id, id, inserted_at), …] · da_thay: {shop_id: (mốc inserted_at, {id POS trả})}
    Trả ([(shop_id, id), …], [cảnh báo]). Hai chốt để không xoá oan đơn thật:
      · POS trả 0 đơn cho shop → không đánh dấu gì ở shop đó (key hỏng, API lỗi câm…);
      · một lượt "mất" > max(toi_thieu, ty_le × số đơn POS trả) → nghi POS trả thiếu, bỏ qua shop."""
    theo_shop = {}
    for shop, id_, ins in trong_bang:
        shop = str(shop)
        if shop not in da_thay:
            continue
        moc, thay = da_thay[shop]
        if str(ins or "") >= str(moc or "") and str(id_) not in thay:
            theo_shop.setdefault(shop, []).append((shop, str(id_)))
    xoa, canh_bao = [], []
    for shop, ds in sorted(theo_shop.items()):
        thay = da_thay[shop][1]
        if not thay:
            canh_bao.append(f"shop {shop}: POS trả 0 đơn — không đánh dấu xoá {len(ds)} đơn đang có trong bảng")
        elif len(ds) > max(toi_thieu, ty_le * len(thay)):
            canh_bao.append(f"shop {shop}: {len(ds)} đơn không còn trên POS trong khi POS trả {len(thay)} đơn "
                            f"— nghi POS trả thiếu, KHÔNG đánh dấu xoá")
        else:
            xoa += ds
    return xoa, canh_bao


# ═══ Ghi vào Postgres ══════════════════════════════════════════════════════════════════════

_TEN_HOP_LE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _ten(bang: str) -> str:
    """Tên bảng / cột ghép thẳng vào SQL — chỉ nhận chữ thường, số, gạch dưới."""
    if not _TEN_HOP_LE.match(bang or ""):
        raise ValueError(f"tên bảng/cột không hợp lệ: {bang!r}")
    return bang


def cot_bang(conn, bang: str) -> dict:
    """{tên cột: kiểu} theo thứ tự cột của bảng. Bảng chưa có → {}."""
    rows = conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s ORDER BY ordinal_position",
        (bang,)).fetchall()
    return {c: k for c, k in rows}


def _gia_tri(v, kieu: str):
    """Giá trị Python → giá trị ghi vào cột (chuỗi rỗng ở cột ngày / số là NULL, số ở cột chữ thành chữ)."""
    if v is None:
        return None
    if kieu == "text":
        if isinstance(v, str):
            return v
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        return str(v)
    if isinstance(v, str) and not v.strip():
        return None          # ngày / số để trống
    if kieu == "bigint" and isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def them_dong(conn, bang: str, rows: list) -> int:
    """Ghi thêm dòng (COPY). Gọi trong transaction của người gọi nếu cần ghi nhiều bảng cùng lúc."""
    if not rows:
        return 0
    cot = cot_bang(conn, _ten(bang))
    if not cot:
        raise RuntimeError(f"Postgres chưa có bảng {bang} — chạy: python -m sync.core.pg migrate")
    thua = sorted({k for r in rows for k in r} - set(cot))
    if thua:
        raise RuntimeError(f"bảng {bang} thiếu cột {thua} — thêm file migration trong db/migrations/")
    ten = list(cot)
    with conn.cursor() as cur:
        with cur.copy(f"COPY {bang} ({', '.join(ten)}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row([_gia_tri(r.get(c), cot[c]) for c in ten])
    return len(rows)


def thay_ca_bang(conn, bang: str, rows: list) -> int:
    """Thay toàn bộ bảng bằng `rows` — tương đương load_truncate. 0 dòng → giữ bảng cũ."""
    if not rows:
        log.warning(f"  [postgres] {bang}: 0 dòng — giữ nguyên bảng cũ")
        return 0
    with conn.transaction():
        conn.execute(f"DELETE FROM {_ten(bang)}")
        them_dong(conn, bang, rows)
    log.info(f"  [postgres] {bang}: {len(rows)} dòng (thay cả bảng)")
    return len(rows)


def _dung_lai(conn, bang: str, chon_sql: str) -> int:
    """Bảng sạch = kết quả `chon_sql` (đọc từ raw). Chạy trong transaction của người gọi."""
    ten = ", ".join(cot_bang(conn, bang))
    conn.execute(f"DELETE FROM {bang}")
    conn.execute(f"INSERT INTO {bang} ({ten}) SELECT {ten} FROM ({chon_sql}) t")
    return conn.execute(f"SELECT COUNT(*) FROM {bang}").fetchone()[0]


def sql_dung_lai_don(bang_don: str, shop_ids=None) -> str:
    """Mỗi (shop_id, id) giữ bản mới nhất trong raw; bản mới nhất là bia mộ thì bỏ đơn.
    NULLS LAST: bản cũ (BigQuery) xếp NULL cuối khi DESC,
    Postgres mặc định xếp đầu — không ghi rõ là đơn mất updated_at thắng đơn có."""
    return f"""
        SELECT * FROM (
            SELECT DISTINCT ON (shop_id, id) * FROM {_ten(bang_don)}_raw
            {_loc_shop(shop_ids, "shop_id")}
            ORDER BY shop_id, id, updated_at DESC NULLS LAST, sync_time DESC NULLS LAST
        ) moi_nhat WHERE COALESCE(status_name, '') <> '{DA_XOA_TREN_POS}'
    """


def sql_dung_lai_item(bang_item: str, shop_ids=None) -> str:
    """Trọn bộ item của LẦN SYNC MỚI NHẤT mỗi đơn (item bị gỡ khỏi đơn thì biến khỏi bảng)."""
    raw = f"{_ten(bang_item)}_raw"
    return f"""
        SELECT DISTINCT ON (r.shop_id, r.order_id, r.item_id) r.*
        FROM {raw} r
        JOIN (SELECT shop_id, order_id, MAX(sync_time) AS mx FROM {raw} GROUP BY 1, 2) l
          ON r.shop_id = l.shop_id AND r.order_id = l.order_id AND r.sync_time = l.mx
        {_loc_shop(shop_ids, "r.shop_id")}
        ORDER BY r.shop_id, r.order_id, r.item_id, r.sync_time DESC
    """


def ghi_don(conn, orders: list, items: list, bang_don: str = "sale_order",
            bang_item: str = "order_items", shop_ids=None, da_thay=None) -> tuple:
    """Ghi đơn + dòng hàng theo cơ chế hai tầng. Trả (số đơn, số item) của bảng sạch.

    Chỉ nối vào raw đơn MỚI hoặc có `updated_at` mới hơn bản đang có (kèm toàn bộ item của đơn đó),
    cộng bia mộ cho đơn đã xoá trên POS (da_thay: {shop_id: (mốc inserted_at, {id POS trả})} của
    những shop kéo ĐỦ ở vòng này). Khoá đơn là (shop_id, id): POS đánh số riêng từng shop."""
    bang_don, bang_item = _ten(bang_don), _ten(bang_item)
    with conn.transaction():
        known = {f"{s}|{i}": (t or "") for s, i, t in conn.execute(
            f"SELECT shop_id, id, MAX(updated_at) FROM {bang_don} GROUP BY 1, 2")}
        trong = {c: {f"{s}|{i}" for s, i in conn.execute(
            f"SELECT shop_id, id FROM {bang_don} WHERE COALESCE({_ten(c)}, '') = ''")}
            for c in COT_DIEN_NGUOC}
        doi = chon_don_can_ghi(orders, known, trong=trong)
        khoa_doi = {(str(o.get("shop_id", "")), str(o.get("id", ""))) for o in doi}
        item_doi = [it for it in items
                    if (str(it.get("shop_id", "")), str(it.get("order_id", ""))) in khoa_doi]
        log.info(f"  [postgres] Đơn kéo về {len(orders)} → {len(doi)} đơn mới/đổi trạng thái")
        them_dong(conn, f"{bang_don}_raw", doi)
        them_dong(conn, f"{bang_item}_raw", item_doi)

        if da_thay:
            shops = [str(x) for x in da_thay if str(x).isdigit()]
            dang_co = conn.execute(
                f"SELECT shop_id, id, inserted_at FROM {bang_don} WHERE shop_id = ANY(%s)",
                (shops,)).fetchall() if shops else []
            xoa, canh_bao = chon_don_da_xoa(dang_co, da_thay)
            for c in canh_bao:
                log.warning(f"  [postgres] {bang_don}: {c}")
            if xoa:
                from datetime import datetime
                from psycopg.rows import dict_row

                khoa = [f"{a}|{b}" for a, b in xoa]
                bay_gio = (max((str(o.get("sync_time") or "") for o in orders), default="")
                           or datetime.utcnow().isoformat())
                with conn.cursor(row_factory=dict_row) as cur:
                    bia = cur.execute(
                        f"SELECT * FROM {bang_don} WHERE shop_id || '|' || id = ANY(%s)", (khoa,)).fetchall()
                for d in bia:
                    d["status_name"] = DA_XOA_TREN_POS
                    d["sync_time"] = bay_gio
                them_dong(conn, f"{bang_don}_raw", bia)
                log.info(f"  [postgres] {bang_don}: {len(bia)} đơn không còn trên POS → bỏ khỏi bảng: "
                         f"{', '.join(khoa[:20])}")

        n_don = _dung_lai(conn, bang_don, sql_dung_lai_don(bang_don, shop_ids))
        n_item = _dung_lai(conn, bang_item, sql_dung_lai_item(bang_item, shop_ids))
    log.info(f"  [postgres] {bang_don}: {n_don} đơn · {bang_item}: {n_item} item (dựng lại từ raw)")
    return n_don, n_item


def ghi_ads(conn, rows: list, bang: str, id_col: str) -> int:
    """Ghi insight quảng cáo theo cơ chế hai tầng: khoá (account_id, id_col, date), bản
    sync_time mới nhất thắng. Cửa sổ kéo chỉ quyết định ngày nào được làm mới, không xoá ngày nào."""
    if id_col not in ("ad_id", "adset_id"):
        raise ValueError(f"id_col lạ: {id_col!r}")
    bang = _ten(bang)
    with conn.transaction():
        them_dong(conn, f"{bang}_raw", rows)
        n = _dung_lai(conn, bang, f"""
            SELECT DISTINCT ON (account_id, {id_col}, date) * FROM {bang}_raw
            ORDER BY account_id, {id_col}, date, sync_time DESC NULLS LAST
        """)
    log.info(f"  [postgres] {bang}: {len(rows)} dòng kéo về → bảng {n} dòng (dựng lại từ raw)")
    return n


def ad_id_can_tra(conn, bang_don: str = "sale_order", toi_da: int = 600) -> list:
    """ad_id nằm trên đơn mà chưa có trong chi tiêu (mọi TKQC, fb_ads_tat_ca) lẫn ad_dictionary —
    câu đầu của sync_ad_dictionary (X9)."""
    return [r[0] for r in conn.execute(f"""
        SELECT id FROM (
            SELECT DISTINCT CASE
                WHEN p_utm_term IS NOT NULL AND LENGTH(p_utm_term) > 10
                     AND p_utm_term ~ '^[0-9]+$' THEN p_utm_term
                WHEN ad_id IS NOT NULL AND TRIM(ad_id) <> '' THEN ad_id
            END AS id
            FROM {_ten(bang_don)}
        ) can
        WHERE id IS NOT NULL
          AND id NOT IN (SELECT ad_id FROM fb_ads_tat_ca WHERE ad_id IS NOT NULL)
          AND id NOT IN (SELECT ad_id FROM ad_dictionary WHERE ad_id IS NOT NULL)
        LIMIT %s""", (int(toi_da),))]
