"""
sync/core/pg_writer.py — ghi số vào Postgres, cùng luật với bq_writer (04/11/2026).

Giữ NGUYÊN cơ chế hai tầng của BigQuery (X1/X2, xem bq_writer): <bảng>_raw chỉ ghi thêm, bảng sạch
dựng lại từ raw mỗi vòng — kéo hụt không xoá được số đã có, đơn bị xoá trên POS có dòng "bia mộ".
Luật chọn đơn dùng chung với bq_writer, không chép.

Khác BigQuery ở chỗ có transaction: ghi raw + dựng lại bảng sạch nằm trong MỘT transaction. Lỗi giữa
chừng là mọi thứ quay về như trước vòng chạy; người đang đọc thấy bảng cũ cho tới lúc COMMIT. Bước
"DELETE bảng sạch rồi INSERT lại" vì thế an toàn — khác hẳn pattern drop-trước-khi-fetch đã bị cấm.

Cột lấy từ bảng thật trong Postgres (information_schema), không lấy từ schema BigQuery: dòng mang cột
bảng chưa có thì báo lỗi rõ "thêm migration", không lặng lẽ bỏ cột.
"""
import json
import logging
import re

from sync.core.bq_writer import (
    COT_DIEN_NGUOC, DA_XOA_TREN_POS, _loc_shop, chon_don_can_ghi, chon_don_da_xoa,
)

log = logging.getLogger(__name__)

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
    """Giá trị Python → giá trị ghi vào cột, theo đúng cách BigQuery nhận dòng JSON."""
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
    Cùng luật với bq_writer.sql_rebuild_orders. NULLS LAST: BigQuery xếp NULL cuối khi DESC,
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
    """Tương đương bq_writer.append_and_rebuild_orders. Trả (số đơn, số item) của bảng sạch."""
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
    """Tương đương bq_writer.append_and_rebuild_ads: khoá (account_id, id_col, date), bản
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
    """ad_id nằm trên đơn mà chưa có trong fb_ads_data lẫn ad_dictionary — câu Postgres của
    truy vấn đầu sync_ad_dictionary (X9)."""
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
          AND id NOT IN (SELECT ad_id FROM fb_ads_data WHERE ad_id IS NOT NULL)
          AND id NOT IN (SELECT ad_id FROM ad_dictionary WHERE ad_id IS NOT NULL)
        LIMIT %s""", (int(toi_da),))]
