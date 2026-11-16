"""
Đổi shop POS Đài Loan sang "TAIWAN SỸ ANH" (1022091930) — 14/09/2026.

Chạy: python3 -m pytest tests/test_talpha_doi_shop_pos.py -q

Canh hai chỗ làm sai số nếu trượt:
  • Đơn ghi bằng VND trong shop TWD — để nguyên thì bị nhân tỷ giá thành hàng trăm
    triệu, bỏ đi thì mất cả tuần đơn đầu tháng.
  • Hai shop cùng nhãn "TW" dùng chung mã đơn 1…281 — khoá theo nhãn là nhập đơn của
    hai shop khác nhau làm một, và đơn shop cũ lọt vào báo cáo của shop mới.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.business_rules import convert_order_currency, revenue_vnd  # noqa: E402
from sync.core.pg_writer import _shop_filter, sql_rebuild_orders  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))
from talpha_rules import norm_pos_nv  # noqa: E402


def _order(**kw):
    base = {"id": "A715108714.2", "order_currency": "VND", "cod": 1_210_000.0,
            "total_price": 0.0, "shipping_fee": 1_210_000.0, "money_to_collect": 1_210_000.0}
    base.update(kw)
    return base


class TestVndOrderInTwdShop:
    def test_twd_order_unchanged(self):
        order = _order(order_currency="TWD", cod=799.0, total_price=799.0, shipping_fee=0.0)
        result = convert_order_currency(order, [], "TWD", 800)
        assert result is not None and result[0] is order

    def test_order_without_currency_uses_shop_currency(self):
        don = _order(order_currency=None, cod=999.0)
        assert convert_order_currency(don, [], "TWD", 800)[0]["cod"] == 999.0

    def test_vnd_order_to_twd_revenue_matches_original(self):
        # Đơn thật shop 1022091930: 1.210.000đ ghi ở ô phí vận chuyển.
        don, _ = convert_order_currency(_order(), [], "TWD", 800)
        assert don["order_currency"] == "TWD"
        assert don["cod"] == 1512.5
        assert revenue_vnd(don["cod"], "TW") == 1_210_000.0

    def test_minor_unit_shop_multiplies_divisor(self):
        # Singapore: số chia 100. 1.210.000đ → 60,5 SGD → lưu 6050 → ÷100 × 20.000 = 1.210.000đ.
        don, _ = convert_order_currency(_order(), [], "SGD", 20000, 100)
        assert don["cod"] == 6050.0
        assert revenue_vnd(don["cod"], "SG") == 1_210_000.0

    def test_all_money_fields_converted(self):
        don, _ = convert_order_currency(_order(total_discount=80_000.0), [], "TWD", 800)
        assert don["shipping_fee"] == 1512.5 and don["money_to_collect"] == 1512.5
        assert don["total_discount"] == 100.0

    def test_original_order_not_mutated(self):
        original = _order()
        convert_order_currency(original, [], "TWD", 800)
        assert original["cod"] == 1_210_000.0 and original["order_currency"] == "VND"

    def test_item_converts_retail_price_not_import_price(self):
        item = {"order_id": "A715108714.2", "retail_price": 640_000.0, "avg_imported_price": 95.0}
        _, items = convert_order_currency(_order(), [item], "TWD", 800)
        assert items[0]["retail_price"] == 800.0
        assert items[0]["avg_imported_price"] == 95.0

    def test_other_currency_dropped_without_guessing(self):
        assert convert_order_currency(_order(order_currency="USD"), [], "TWD", 800) is None

    def test_shop_without_rate_dropped(self):
        assert convert_order_currency(_order(), [], "TWD", None) is None
        assert convert_order_currency(_order(), [], "TWD", 0) is None


class TestOrderTableOnlyConfiguredShops:
    def test_key_by_shop_id_not_label(self):
        sql = sql_rebuild_orders("sale_order", ["1022091930"])
        assert "DISTINCT ON (shop_id, id)" in sql
        assert "shop_label" not in sql

    def test_filter_configured_shops(self):
        sql = sql_rebuild_orders("sale_order", ["1022091930"])
        assert "WHERE shop_id IN ('1022091930')" in sql
        assert "408074608" not in sql

    def test_missing_shop_id_no_filter(self):
        # Thiếu mã thì lọc là xoá trắng bảng đơn — thà không lọc.
        assert _shop_filter(None, "t.shop_id") == ""
        assert _shop_filter([], "t.shop_id") == ""
        assert _shop_filter(["1022091930", ""], "t.shop_id") == ""

    def test_non_numeric_shop_id_rejected(self):
        with pytest.raises(ValueError):
            _shop_filter(["1022091930') OR ('1'='1"], "t.shop_id")


class TestPosAccountNames:
    """Tài khoản POS shop mới không mang tên thật (Sỹ Anh xác nhận 15/09/2026)."""

    def test_three_accounts_map_to_right_person(self):
        assert norm_pos_nv("Chun Ho") == "Loc"
        assert norm_pos_nv("Thanh Ngô Thanh") == "Thai"
        assert norm_pos_nv("Linh Thy Hoang") == "Thang"
        assert norm_pos_nv("Thương Thương") == "Thuong"

    def test_other_thanh_not_matched(self):
        assert norm_pos_nv("Nguyễn Thanh") is None
