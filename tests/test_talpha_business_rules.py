"""
Rule nghiệp vụ TALPHA — hệ MỘT thị trường Đài Loan (từ 05/09/2026).

Chạy: python3 -m pytest tests/test_talpha_business_rules.py -q

Bài test này canh đúng những chỗ đã từng làm sai số thật:
  • X13 — shop Đài lưu NGUYÊN TWD, chia 100 là tiền tụt đúng 100 lần
  • Doanh thu chỉ tính đơn GIAO THÀNH CÔNG và cod > 0
  • Spend quảng cáo ĐÃ là VND — quy đổi thêm lần nữa là thổi chi phí lên
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sync.core.business_rules import (  # noqa: E402
    FX_RATES_TO_VND, POS_MONEY_DIVISOR, MARKET_NAMES,
    money_divisor, calc_revenue_local, is_success_order, to_vnd, revenue_vnd,
    get_market_display, get_market_timezone, extract_marketer_name,
    is_valid_marketer, validate_ads_spend, normalize_ad_id_for_join,
    calc_roas, calc_aov,
)


class TestMarkets:
    """15/09/2026: Đài Loan và Singapore đang bán; UAE đã nối shop nhưng chưa có tỷ giá."""

    def test_all_markets_declared(self):
        # 08/10/2026: thêm Nhật (JP) — chưa có shop POS, chỉ có số ads.
        # 11/11/2026: thêm Việt Nam (VN) — shop hạt giống, VND.
        assert set(MARKET_NAMES) == {"TW", "SG", "AE", "JP", "VN"}

    def test_only_measured_markets_have_rate_and_divisor(self):
        # Nước chưa có tỷ giá thì không được có dòng — nhân với số đoán là sai tiền.
        # Nhật: 1 JPY = 160đ (Sỹ Anh chốt 08/10/2026), số chia TẠM 1 — chưa có đơn để đo.
        # Việt Nam: đã là đồng → tỷ giá 1, POS lưu nguyên đồng (đo 11/11/2026: cod 99000 = 99.000đ).
        assert FX_RATES_TO_VND == {"TW": 800, "SG": 20000, "AE": 7000, "JP": 160, "VN": 1, "USD": 25700}
        assert POS_MONEY_DIVISOR == {"TW": 1, "SG": 100, "AE": 100, "JP": 1, "VN": 1}

    def test_singapore_49_sgd_stored_as_4900(self):
        # Poscake lưu SGD theo đơn vị nhỏ: cod 4900 = 49 SGD = 980.000đ.
        assert revenue_vnd(4900, "SG") == 980_000.0

    def test_uae_49_aed_stored_as_4900(self):
        # Tỷ giá 7.000đ/AED (chốt 15/09/2026), số chia 100 chưa đo: cod 4900 = 49 AED = 343.000đ.
        assert revenue_vnd(4900, "AE") == 343_000.0

    def test_convert_market_without_rate_raises(self):
        with pytest.raises(ValueError):
            to_vnd(49, "KW")

    def test_active_market_fully_configured(self):
        # Chuyển một nước sang "active" mà quên shop, tỷ giá hay số chia → đỏ trước deploy.
        import json
        cfg = json.load(open(Path(__file__).resolve().parent.parent / "config" / "talpha_rules.json", encoding="utf-8"))
        for name, v in cfg["markets"].items():
            if not isinstance(v, dict):
                continue
            assert v.get("status") in ("active", "upcoming", "disabled"), f"{name}: status lạ {v.get('status')!r}"
            # Nước đã tắt vẫn phải giữ đủ: đơn cũ của nó còn trong báo cáo, cần tỷ giá + số chia.
            if v["status"] in ("active", "disabled"):
                assert str(v.get("shop_id", "")).strip(), f"{name}: đang bán / đã tắt mà không có shop_id"
                assert isinstance(v.get("rate_vnd"), (int, float)) and v["rate_vnd"] > 0, f"{name}: thiếu tỷ giá"
                assert isinstance(v.get("pos_money_divisor"), int) and v["pos_money_divisor"] > 0, f"{name}: thiếu số chia"
            if v.get("rate_vnd"):
                # Có tỷ giá mà trống số chia: view chia 100, Sheet và dashboard chia 1.
                assert isinstance(v.get("pos_money_divisor"), int) and v["pos_money_divisor"] > 0, f"{name}: có tỷ giá mà thiếu số chia"
            assert v.get("currency_symbol"), f"{name}: thiếu ký hiệu tiền"
            # 08/10/2026: Nhật khai shop_id null → Python str(None) = "None" lọt vào bộ lọc shop,
            # sync đơn nổ, Sheet đứng. Chưa có shop thì để chuỗi rỗng.
            assert isinstance(v.get("shop_id", ""), str), f"{name}: shop_id phải là chuỗi (chưa có shop → \"\")"


class TestX13Divisor:
    """Shop Đài lưu nguyên TWD — số chia phải là 1, không phải 100."""

    def test_taiwan_divisor_is_one(self):
        assert money_divisor("TW") == 1

    def test_cod_950_is_950_twd(self):
        # Đơn thật id=336: 1 Birthstone Set + 1 BOX, cod=950 ⇒ 950 TWD (~760k VND).
        assert calc_revenue_local(950, "TW") == 950.0

    def test_odd_cod_not_divided(self):
        for cod in (1390, 999, 1499, 6999):
            assert calc_revenue_local(cod, "TW") == float(cod)

    def test_empty_cod(self):
        assert calc_revenue_local(0, "TW") == 0.0
        assert calc_revenue_local(None, "TW") == 0.0


class TestConvertToVND:
    def test_twd_rate(self):
        assert to_vnd(1, "TW") == 800.0

    def test_real_order_revenue(self):
        # 950 TWD × 800 = 760.000 VND
        assert revenue_vnd(950, "TW") == 760000.0


class TestSuccessfulOrder:
    def test_delivered_with_cod(self):
        assert is_success_order("GIAO_THANH_CONG", 950) is True

    def test_delivered_without_cod_not_counted(self):
        assert is_success_order("GIAO_THANH_CONG", 0) is False

    def test_returned_not_counted(self):
        assert is_success_order("DON_HOAN", 950) is False

    def test_cancelled_not_counted(self):
        assert is_success_order("HUY", 950) is False


class TestMarket:
    def test_display_name(self):
        assert get_market_display("TW") == "Taiwan"

    def test_taipei_timezone(self):
        assert get_market_timezone("TW") == "Asia/Taipei"

    def test_unknown_shop_defaults_to_taipei(self):
        # Chỉ còn một thị trường nên mặc định phải là Đài Bắc, không phải Dubai.
        assert get_market_timezone("XX") == "Asia/Taipei"


class TestMarketer:
    def test_extract_name_from_json(self):
        assert extract_marketer_name('{"name": "Hồ Sỹ Lộc"}') == "Hồ Sỹ Lộc"

    def test_plain_string_name(self):
        assert extract_marketer_name("Chu Thuý") == "Chu Thuý"

    def test_empty_is_invalid(self):
        assert is_valid_marketer("") is False
        assert is_valid_marketer(None) is False


class TestAdSpend:
    def test_spend_already_vnd(self):
        # Rule #3: spend từ Meta đã là VND — hàm không được nhân thêm tỷ giá.
        assert validate_ads_spend(1_000_000) == 1_000_000

    def test_ad_id_as_string_for_join(self):
        assert normalize_ad_id_for_join(123456789) == "123456789"
        assert normalize_ad_id_for_join("123456789") == "123456789"


class TestMetrics:
    def test_roas(self):
        assert calc_roas(3_000_000, 1_000_000) == 3.0

    def test_roas_divide_by_zero(self):
        assert calc_roas(3_000_000, 0) is None

    def test_aov(self):
        assert calc_aov(7_600_000, 10) == 760_000.0

    def test_aov_no_orders(self):
        assert calc_aov(7_600_000, 0) is None
