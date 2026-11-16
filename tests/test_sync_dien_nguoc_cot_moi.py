"""
Đồng bộ POS thêm cột SAU khi bảng đơn đã có dữ liệu (17/09/2026: page_name, seller_name).

Chạy: python3 -m pytest tests/test_sync_dien_nguoc_cot_moi.py -q

Bảng đơn chỉ nối vào raw những đơn đổi `updated_at`. Thêm cột mà không điền ngược thì đơn cũ
không đổi trạng thái mang NULL mãi — báo cáo nối đơn → campaign bằng tên page sẽ coi cả loạt
đơn đầu tháng là "không có nguồn đơn" dù POS có đủ tên page.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.pg_writer import select_orders_to_upsert  # noqa: E402


def order(id_, updated, page="", seller=""):
    return {"shop_id": "1022091930", "id": id_, "updated_at": updated, "page_name": page, "seller_name": seller}


KNOWN = {"1022091930|1": "2026-09-10T01:00", "1022091930|2": "2026-09-10T01:00"}


def test_old_rule_appends_only_new_or_status_changed():
    ds = [order("1", "2026-09-10T01:00", "Page A"), order("2", "2026-09-12T01:00", "Page B"), order("3", "2026-09-12T01:00")]
    assert [o["id"] for o in select_orders_to_upsert(ds, KNOWN)] == ["2", "3"]


def test_table_missing_new_column_reappends_whole_window():
    ds = [order("1", "2026-09-10T01:00", "Page A"), order("2", "2026-09-10T01:00")]
    assert [o["id"] for o in select_orders_to_upsert(ds, KNOWN, missing_columns=True)] == ["1", "2"]


def test_blank_column_with_pos_value_is_backfilled():
    empty_keys = {"page_name": {"1022091930|1", "1022091930|2"}, "seller_name": set()}
    ds = [order("1", "2026-09-10T01:00", "Page A"), order("2", "2026-09-10T01:00", "")]
    # đơn 2: POS cũng trống tên page → không nối lại vô ích mỗi giờ
    assert [o["id"] for o in select_orders_to_upsert(ds, KNOWN, empty_keys=empty_keys)] == ["1"]


def test_already_backfilled_does_nothing():
    ds = [order("1", "2026-09-10T01:00", "Page A", "Thương Thương")]
    assert select_orders_to_upsert(ds, KNOWN, empty_keys={"page_name": set(), "seller_name": set()}) == []


def test_seller_assigned_later_also_backfilled():
    ds = [order("1", "2026-09-10T01:00", "Page A", "Chun Ho")]
    empty = {"page_name": set(), "seller_name": {"1022091930|1"}}
    assert [o["id"] for o in select_orders_to_upsert(ds, KNOWN, empty_keys=empty)] == ["1"]
