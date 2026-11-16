"""
Bảng đơn của đối tác 3PL (Google Sheet) → bảng Postgres partner_orders.

Tách khỏi talpha_sync.py (16/11/2026) — code chuyển nguyên văn; talpha_sync nhập lại
sync_partner_orders. Thay cả bảng trong MỘT transaction (pg_writer.replace_table).
"""
import json
import os

from sync.core import pg_writer
from sync.core.partner_sheet import normalize_rows, read_sheet
from sync.talpha.sync_runtime import PROJECT_DIR, _pg, log, sync_time


# ═══════════════════════════════════════════════════════════════════
# BẢNG ĐƠN ĐỐI TÁC (Google Sheet) → partner_orders
# ═══════════════════════════════════════════════════════════════════


def sync_partner_orders() -> int:
    """Bảng đơn đối tác (config/talpha_rules.json → partner_orders.sheets) → Postgres.

    Thay CẢ bảng một lần trong một transaction. Một bảng đọc lỗi thì NÉM lỗi và KHÔNG ghi gì —
    thay bằng các bảng còn lại là xoá mất dòng của bảng lỗi. Tiền COD giữ
    nguyên đơn vị trong bảng đối tác (cột currency), không quy đổi ở đây.
    """
    with open(os.path.join(PROJECT_DIR, "config", "talpha_rules.json"), encoding="utf-8") as fh:
        cfg = json.load(fh).get("partner_orders") or {}
    sheets = [x for x in cfg.get("sheets") or [] if isinstance(x, dict) and x.get("sheet_id")]
    if not sheets:
        log.info("  partner_orders: chưa khai bảng nào — bỏ qua")
        return 0
    # Không có khoá Google thì doc_sheet đọc qua link công khai như bảng NAZA của Đài (05/11/2026);
    # bảng để riêng tư thì báo lỗi rõ và GIỮ bảng cũ.
    rows = []
    for sh in sheets:
        values = read_sheet(sh["sheet_id"], str(sh.get("sheet_gid", "0")))
        sheet_rows = normalize_rows(values, cfg.get("column_map") or {},
                          {"market": sh.get("market", ""), "shop_label": sh.get("shop_label", ""),
                           "sheet_id": sh["sheet_id"]}, sync_time)
        log.info(f"  [{sh.get('shop_label')}] bảng đối tác: {len(sheet_rows)} đơn")
        rows.extend(sheet_rows)
    table = cfg.get("table") or "partner_orders"
    n = pg_writer.replace_table(_pg(), table, rows)
    log.info(f"  {table}: {n} rows")
    return n
