"""
Đơn bị XOÁ trên POS phải rời bảng đơn (17/09/2026).

Chạy: python3 -m pytest tests/test_sync_don_xoa_tren_pos.py -q

Sỹ Anh soi ngày 14/09 page Lucky Silver Philippines: Sheet 6 đơn, POS thật 3. Ba đơn thừa
(#59–#61, 0 SGD) đã bị xoá trên POS nhưng bảng đơn chỉ ghi thêm nên giữ chúng mãi. Cả shop
Singapore có 10 đơn như vậy; shop Đài 0.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.pg_writer import DELETED_ON_POS, select_deleted_orders, sql_rebuild_orders  # noqa: E402

SG = "715135541"
TW = "1022091930"
CUTOFF = "2026-09-13T17:00:00"


def test_order_in_window_missing_on_pos_marked_deleted():
    in_table = [(SG, "59", "2026-09-14T12:41:44"), (SG, "77", "2026-09-14T01:34:00"),
                  (SG, "60", "2026-09-14T12:42:02")]
    deleted, warnings = select_deleted_orders(in_table, {SG: (CUTOFF, {"77", "78", "79"})})
    assert sorted(deleted) == [(SG, "59"), (SG, "60")] and warnings == []


def test_order_older_than_window_untouched():
    # Cửa sổ chỉ kéo từ MOC — đơn cũ hơn POS không trả về là chuyện bình thường, không phải bị xoá.
    deleted, _ = select_deleted_orders([(SG, "12", "2026-09-01T03:00:00")], {SG: (CUTOFF, {"77"})})
    assert deleted == []


def test_failed_shop_not_in_seen_untouched():
    deleted, _ = select_deleted_orders([(TW, "5", "2026-09-14T00:00:00")], {SG: (CUTOFF, {"77"})})
    assert deleted == []


def test_pos_returns_zero_orders_deletes_nothing():
    deleted, warnings = select_deleted_orders([(SG, "77", "2026-09-14T01:34:00")], {SG: (CUTOFF, set())})
    assert deleted == [] and "POS trả 0 đơn" in warnings[0]


def test_too_many_missing_suspects_partial_pos_response():
    in_table = [(TW, str(i), "2026-09-14T00:00:00") for i in range(100)]
    seen_ids = {str(i) for i in range(60)}                       # POS "mất" 40 đơn một lượt
    deleted, warnings = select_deleted_orders(in_table, {TW: (CUTOFF, seen_ids)})
    assert deleted == [] and "nghi POS trả thiếu" in warnings[0]


def test_few_deleted_still_uses_min_threshold():
    in_table = [(SG, str(i), "2026-09-14T00:00:00") for i in range(25)]
    replaced = {str(i) for i in range(15)}                       # 10 đơn xoá, POS còn 15: dưới ngưỡng 20
    deleted, warnings = select_deleted_orders(in_table, {SG: (CUTOFF, replaced)})
    assert len(deleted) == 10 and warnings == []


def test_rebuild_drops_tombstones_and_filters_shops():
    sql = sql_rebuild_orders("sale_order", [TW, SG])
    assert f"COALESCE(status_name, '') <> '{DELETED_ON_POS}'" in sql
    assert "updated_at DESC NULLS LAST, sync_time DESC NULLS LAST" in sql     # dòng đánh dấu cùng updated_at, sync_time mới hơn → thắng
    assert f"WHERE shop_id IN ('{TW}', '{SG}')" in sql
