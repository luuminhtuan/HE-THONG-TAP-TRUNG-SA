"""
Đơn TRỐNG (không sản phẩm, 0 tiền) không tính vào số đơn — Sỹ Anh chốt 17/09/2026.

Chạy: python3 -m pytest tests/test_talpha_don_trong.py -q

Ngày 15/09 báo cáo Đài ghi Lộc 3 đơn, POS 2: đơn #381 không sản phẩm, 0 TWD, không tag marketer,
bị gán cho Lộc theo page. Cả tháng 9 shop Đài có ~87 đơn kiểu này, số đơn thổi lên ~4 lần.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

from talpha_rules import is_empty_order, sql_is_empty_order  # noqa: E402


def test_order_381_is_empty():
    # dữ liệu thật của #381 trong bảng đơn: total_quantity là chuỗi "0", tiền 0
    assert is_empty_order("0", 0.0, 0.0) is True


def test_blank_cells_count_as_zero():
    assert is_empty_order(None, None, None) is True
    assert is_empty_order("", "", "") is True


def test_real_order_with_items_and_money_counted():
    assert is_empty_order("1", 799.0, 799.0) is False


def test_money_without_quantity_still_counted():
    # chỉ bỏ khi KHÔNG hàng VÀ KHÔNG tiền — thiếu một trong hai là vẫn là đơn
    assert is_empty_order("0", 0.0, 999.0) is False
    assert is_empty_order("0", 1299.0, 0.0) is False


def test_items_with_zero_money_still_counted():
    # đơn tặng / đổi hàng: có sản phẩm mà 0 đồng — vẫn là đơn thật
    assert is_empty_order("2", 0.0, 0.0) is False


def test_non_numeric_quantity_not_guessed():
    assert is_empty_order("abc", 0, 0) is False


def test_sql_same_condition():
    sql = sql_is_empty_order()
    assert "COALESCE(CASE WHEN btrim(total_quantity) ~" in sql and "COALESCE(cod, 0) = 0" in sql
    assert "COALESCE(total_price, 0) = 0" in sql
    assert "t.total_price" in sql_is_empty_order("t")
