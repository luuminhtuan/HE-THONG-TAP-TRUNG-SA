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

def _shop_filter(shop_ids, columns: str) -> str:
    """Mệnh đề WHERE giữ đúng các shop đang khai. Rỗng/thiếu mã shop → không lọc.

    Mã shop POS là dãy số; nhận thứ khác là từ chối luôn, vì chuỗi này ghép thẳng vào SQL.
    """
    ids = [str(s).strip() for s in (shop_ids or [])]
    if not ids or any(not s for s in ids):
        return ""
    for s in ids:
        if not s.isdigit():
            raise ValueError(f"shop_id phải là dãy số, nhận {s!r}")
    return f"WHERE {columns} IN (" + ", ".join(f"'{s}'" for s in ids) + ")"


# Đơn bị XOÁ trên POS (17/09/2026: 10 đơn Singapore #59–#81 — ngày 14/09 Sheet ra 6 đơn, POS thật 3).
# Raw chỉ ghi thêm, nên đơn đã xoá cứ nằm lại mãi ở bản cuối cùng từng thấy. Vòng sync nào kéo ĐỦ
# cửa sổ của một shop mà không còn thấy đơn đó thì nối vào raw một dòng "bia mộ": y bản cuối, trạng
# thái = dấu này, sync_time mới hơn → thắng khi dựng lại → bảng sạch bỏ đơn đó. Raw vẫn giữ nguyên
# lịch sử. Đơn hiện lại trên POS thì vòng sau nối bản mới → sống lại.
DELETED_ON_POS = "__da_xoa_tren_pos__"

# Cột thêm SAU khi bảng đơn đã có dữ liệu (17/09/2026: tên page + sale). Đơn cũ không đổi
# `updated_at` thì không bao giờ được nối lại → mãi mang NULL ở cột mới. Vòng sync nào thấy
# POS đã có giá trị mà bảng còn trống thì nối lại đơn đó MỘT lần — tự lành.
BACKFILL_COLUMNS = ("page_name", "seller_name")


def select_orders_to_upsert(orders, known, missing_columns=False, empty_keys=None, columns=BACKFILL_COLUMNS):
    """Đơn phải nối vào raw:
      · đơn mới, hoặc `updated_at` mới hơn bản đang có;
      · bảng sạch CHƯA có cột mới (thieu_cot) → mọi đơn trong cửa sổ, để điền ngược;
      · bảng đang TRỐNG cột mới ở đơn đó (trong[cột] chứa khoá) mà POS đã có giá trị.
    known: {"shop_id|id": updated_at} · trong: {tên cột: {"shop_id|id", …}}."""
    empty_keys = empty_keys or {}
    out = []
    for o in orders:
        k = f"{o.get('shop_id', '')}|{o.get('id', '')}"
        if (missing_columns
                or str(o.get("updated_at", "")) > known.get(k, "")
                or any(o.get(c) and k in empty_keys.get(c, ()) for c in columns)):
            out.append(o)
    return out


def select_deleted_orders(in_table, seen_by_shop, min_count=20, max_ratio=0.3):
    """Đơn bị XOÁ trên POS: đang có trong bảng sạch, thuộc cửa sổ vừa kéo ĐỦ của shop, mà POS
    không trả về nữa.
    trong_bang: [(shop_id, id, inserted_at), …] · da_thay: {shop_id: (mốc inserted_at, {id POS trả})}
    Trả ([(shop_id, id), …], [cảnh báo]). Hai chốt để không xoá oan đơn thật:
      · POS trả 0 đơn cho shop → không đánh dấu gì ở shop đó (key hỏng, API lỗi câm…);
      · một lượt "mất" > max(toi_thieu, ty_le × số đơn POS trả) → nghi POS trả thiếu, bỏ qua shop."""
    by_shop = {}
    for shop, id_, ins in in_table:
        shop = str(shop)
        if shop not in seen_by_shop:
            continue
        cutoff, seen_ids = seen_by_shop[shop]
        if str(ins or "") >= str(cutoff or "") and str(id_) not in seen_ids:
            by_shop.setdefault(shop, []).append((shop, str(id_)))
    deleted, warnings = [], []
    for shop, ds in sorted(by_shop.items()):
        seen_ids = seen_by_shop[shop][1]
        if not seen_ids:
            warnings.append(f"shop {shop}: POS trả 0 đơn — không đánh dấu xoá {len(ds)} đơn đang có trong bảng")
        elif len(ds) > max(min_count, max_ratio * len(seen_ids)):
            warnings.append(f"shop {shop}: {len(ds)} đơn không còn trên POS trong khi POS trả {len(seen_ids)} đơn "
                            f"— nghi POS trả thiếu, KHÔNG đánh dấu xoá")
        else:
            deleted += ds
    return deleted, warnings


# ═══ Ghi vào Postgres ══════════════════════════════════════════════════════════════════════

_VALID_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def _safe_ident(table: str) -> str:
    """Tên bảng / cột ghép thẳng vào SQL — chỉ nhận chữ thường, số, gạch dưới."""
    if not _VALID_IDENT.match(table or ""):
        raise ValueError(f"tên bảng/cột không hợp lệ: {table!r}")
    return table


def table_columns(conn, table: str) -> dict:
    """{tên cột: kiểu} theo thứ tự cột của bảng. Bảng chưa có → {}."""
    rows = conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s ORDER BY ordinal_position",
        (table,)).fetchall()
    return {c: k for c, k in rows}


def _to_db_value(v, col_type: str):
    """Giá trị Python → giá trị ghi vào cột (chuỗi rỗng ở cột ngày / số là NULL, số ở cột chữ thành chữ)."""
    if v is None:
        return None
    if col_type == "text":
        if isinstance(v, str):
            return v
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        return str(v)
    if isinstance(v, str) and not v.strip():
        return None          # ngày / số để trống
    if col_type == "bigint" and isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def insert_rows(conn, table: str, rows: list) -> int:
    """Ghi thêm dòng (COPY). Gọi trong transaction của người gọi nếu cần ghi nhiều bảng cùng lúc."""
    if not rows:
        return 0
    columns = table_columns(conn, _safe_ident(table))
    if not columns:
        raise RuntimeError(f"Postgres chưa có bảng {table} — chạy: python -m sync.core.pg migrate")
    unknown_columns = sorted({k for r in rows for k in r} - set(columns))
    if unknown_columns:
        raise RuntimeError(f"bảng {table} thiếu cột {unknown_columns} — thêm file migration trong db/migrations/")
    col_names = list(columns)
    with conn.cursor() as cur:
        with cur.copy(f"COPY {table} ({', '.join(col_names)}) FROM STDIN") as cp:
            for r in rows:
                cp.write_row([_to_db_value(r.get(c), columns[c]) for c in col_names])
    return len(rows)


def replace_table(conn, table: str, rows: list) -> int:
    """Thay toàn bộ bảng bằng `rows` — tương đương load_truncate. 0 dòng → giữ bảng cũ."""
    if not rows:
        log.warning(f"  [postgres] {table}: 0 dòng — giữ nguyên bảng cũ")
        return 0
    with conn.transaction():
        conn.execute(f"DELETE FROM {_safe_ident(table)}")
        insert_rows(conn, table, rows)
    log.info(f"  [postgres] {table}: {len(rows)} dòng (thay cả bảng)")
    return len(rows)


def _rebuild_from_raw(conn, table: str, select_sql: str) -> int:
    """Bảng sạch = kết quả `chon_sql` (đọc từ raw). Chạy trong transaction của người gọi."""
    name = ", ".join(table_columns(conn, table))
    conn.execute(f"DELETE FROM {table}")
    conn.execute(f"INSERT INTO {table} ({name}) SELECT {name} FROM ({select_sql}) t")
    return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def sql_rebuild_orders(orders_table: str, shop_ids=None) -> str:
    """Mỗi (shop_id, id) giữ bản mới nhất trong raw; bản mới nhất là bia mộ thì bỏ đơn.
    NULLS LAST: bản cũ (BigQuery) xếp NULL cuối khi DESC,
    Postgres mặc định xếp đầu — không ghi rõ là đơn mất updated_at thắng đơn có."""
    return f"""
        SELECT * FROM (
            SELECT DISTINCT ON (shop_id, id) * FROM {_safe_ident(orders_table)}_raw
            {_shop_filter(shop_ids, "shop_id")}
            ORDER BY shop_id, id, updated_at DESC NULLS LAST, sync_time DESC NULLS LAST
        ) moi_nhat WHERE COALESCE(status_name, '') <> '{DELETED_ON_POS}'
    """


def sql_rebuild_items(items_table: str, shop_ids=None) -> str:
    """Trọn bộ item của LẦN SYNC MỚI NHẤT mỗi đơn (item bị gỡ khỏi đơn thì biến khỏi bảng)."""
    raw = f"{_safe_ident(items_table)}_raw"
    return f"""
        SELECT DISTINCT ON (r.shop_id, r.order_id, r.item_id) r.*
        FROM {raw} r
        JOIN (SELECT shop_id, order_id, MAX(sync_time) AS mx FROM {raw} GROUP BY 1, 2) l
          ON r.shop_id = l.shop_id AND r.order_id = l.order_id AND r.sync_time = l.mx
        {_shop_filter(shop_ids, "r.shop_id")}
        ORDER BY r.shop_id, r.order_id, r.item_id, r.sync_time DESC
    """


def write_orders(conn, orders: list, items: list, orders_table: str = "sale_order",
            items_table: str = "order_items", shop_ids=None, replaced=None) -> tuple:
    """Ghi đơn + dòng hàng theo cơ chế hai tầng. Trả (số đơn, số item) của bảng sạch.

    Chỉ nối vào raw đơn MỚI hoặc có `updated_at` mới hơn bản đang có (kèm toàn bộ item của đơn đó),
    cộng bia mộ cho đơn đã xoá trên POS (da_thay: {shop_id: (mốc inserted_at, {id POS trả})} của
    những shop kéo ĐỦ ở vòng này). Khoá đơn là (shop_id, id): POS đánh số riêng từng shop."""
    orders_table, items_table = _safe_ident(orders_table), _safe_ident(items_table)
    with conn.transaction():
        known = {f"{s}|{i}": (t or "") for s, i, t in conn.execute(
            f"SELECT shop_id, id, MAX(updated_at) FROM {orders_table} GROUP BY 1, 2")}
        empty_keys = {c: {f"{s}|{i}" for s, i in conn.execute(
            f"SELECT shop_id, id FROM {orders_table} WHERE COALESCE({_safe_ident(c)}, '') = ''")}
            for c in BACKFILL_COLUMNS}
        changed = select_orders_to_upsert(orders, known, empty_keys=empty_keys)
        changed_keys = {(str(o.get("shop_id", "")), str(o.get("id", ""))) for o in changed}
        changed_items = [it for it in items
                    if (str(it.get("shop_id", "")), str(it.get("order_id", ""))) in changed_keys]
        log.info(f"  [postgres] Đơn kéo về {len(orders)} → {len(changed)} đơn mới/đổi trạng thái")
        insert_rows(conn, f"{orders_table}_raw", changed)
        insert_rows(conn, f"{items_table}_raw", changed_items)

        if replaced:
            shops = [str(x) for x in replaced if str(x).isdigit()]
            existing = conn.execute(
                f"SELECT shop_id, id, inserted_at FROM {orders_table} WHERE shop_id = ANY(%s)",
                (shops,)).fetchall() if shops else []
            deleted, warnings = select_deleted_orders(existing, replaced)
            for c in warnings:
                log.warning(f"  [postgres] {orders_table}: {c}")
            if deleted:
                from datetime import datetime
                from psycopg.rows import dict_row

                keys = [f"{a}|{b}" for a, b in deleted]
                now = (max((str(o.get("sync_time") or "") for o in orders), default="")
                           or datetime.utcnow().isoformat())
                with conn.cursor(row_factory=dict_row) as cur:
                    tombstones = cur.execute(
                        f"SELECT * FROM {orders_table} WHERE shop_id || '|' || id = ANY(%s)", (keys,)).fetchall()
                for d in tombstones:
                    d["status_name"] = DELETED_ON_POS
                    d["sync_time"] = now
                insert_rows(conn, f"{orders_table}_raw", tombstones)
                log.info(f"  [postgres] {orders_table}: {len(tombstones)} đơn không còn trên POS → bỏ khỏi bảng: "
                         f"{', '.join(keys[:20])}")

        n_orders = _rebuild_from_raw(conn, orders_table, sql_rebuild_orders(orders_table, shop_ids))
        n_item = _rebuild_from_raw(conn, items_table, sql_rebuild_items(items_table, shop_ids))
    log.info(f"  [postgres] {orders_table}: {n_orders} đơn · {items_table}: {n_item} item (dựng lại từ raw)")
    return n_orders, n_item


def write_ads(conn, rows: list, table: str, id_col: str) -> int:
    """Ghi insight quảng cáo theo cơ chế hai tầng: khoá (account_id, id_col, date), bản
    sync_time mới nhất thắng. Cửa sổ kéo chỉ quyết định ngày nào được làm mới, không xoá ngày nào."""
    if id_col not in ("ad_id", "adset_id"):
        raise ValueError(f"id_col lạ: {id_col!r}")
    table = _safe_ident(table)
    with conn.transaction():
        insert_rows(conn, f"{table}_raw", rows)
        n = _rebuild_from_raw(conn, table, f"""
            SELECT DISTINCT ON (account_id, {id_col}, date) * FROM {table}_raw
            ORDER BY account_id, {id_col}, date, sync_time DESC NULLS LAST
        """)
    log.info(f"  [postgres] {table}: {len(rows)} dòng kéo về → bảng {n} dòng (dựng lại từ raw)")
    return n


def ad_ids_to_lookup(conn, orders_table: str = "sale_order", limit: int = 600) -> list:
    """ad_id nằm trên đơn mà chưa có trong chi tiêu (mọi TKQC, fb_ads_all) lẫn ad_dictionary —
    câu đầu của sync_ad_dictionary (X9)."""
    return [r[0] for r in conn.execute(f"""
        SELECT id FROM (
            SELECT DISTINCT CASE
                WHEN p_utm_term IS NOT NULL AND LENGTH(p_utm_term) > 10
                     AND p_utm_term ~ '^[0-9]+$' THEN p_utm_term
                WHEN ad_id IS NOT NULL AND TRIM(ad_id) <> '' THEN ad_id
            END AS id
            FROM {_safe_ident(orders_table)}
        ) can
        WHERE id IS NOT NULL
          AND id NOT IN (SELECT ad_id FROM fb_ads_all WHERE ad_id IS NOT NULL)
          AND id NOT IN (SELECT ad_id FROM ad_dictionary WHERE ad_id IS NOT NULL)
        LIMIT %s""", (int(limit),))]
