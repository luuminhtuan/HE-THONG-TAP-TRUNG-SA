"""
Ba thị trường — Đài Loan · Singapore · UAE (Sỹ Anh chốt 15/09/2026).

Chạy: python3 -m pytest tests/test_talpha_multi_market.py -q

Canh luật gán nước cho chi tiêu quảng cáo: ô đầu tên campaign là nước; tên cũ không ghi
nước vẫn tính Đài nhưng phải nhận ra được để cảnh báo.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

from talpha_rules import (  # noqa: E402
    norm_nv, norm_pos_nv, credited_marketer, MARKET_OWNER,
    campaign_market, RATE, MONEY_DIV, ACTIVE_MARKETS, CURRENCY_SYMBOL, NO_TEST_MARKETS, is_test,
    cost_price_vnd, COST_RATE_RMB_VND, RULES,
)


class TestMarketFromCampaignName:
    def test_first_cell_is_market(self):
        assert campaign_market("TW/LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808") == ("Taiwan", "o_dau")
        assert campaign_market("SG/LOC/PHI/042-BLACK/LuxeGold/1509") == ("Singapore", "o_dau")
        assert campaign_market("AE/THAI/PHI/040-VONGVANG1/LumoraJewelry/1509") == ("UAE", "o_dau")

    def test_japan(self):
        # 08/10/2026: camp Nhật đầu tiên — trước khi khai JP, cả hai bị tính về Đài.
        assert campaign_market("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10") == ("Japan", "o_dau")
        assert campaign_market("JP/THƯƠNG/PHI/011/Lucky Silver JP/08-10") == ("Japan", "o_dau")
        # Tên trang có chữ Japan/JP KHÔNG phải ô nước.
        assert campaign_market("TW/THƯƠNG/PHI/042/Japan Prime Leather/6-10")[0] == "Taiwan"
        # 09/10/2026 nối shop POS "JAPAN" 1022115860 — đang bán, POS lưu nguyên yên.
        assert "Japan" in ACTIVE_MARKETS and MONEY_DIV["Japan"] == 1 and RATE["Japan"] == 160

    def test_sy_anh_camps_and_orders_in_japan(self):
        # 10/10/2026: camp JAPAN/ANH/… (3,8tr/ngày) bị Sheet bỏ hẳn, 17 đơn tag "Hồ Sỹ Aanh" vào (không gán).
        assert campaign_market("JAPAN/ANH/PHI/Birstone/Veloura Collection Gold/10-10")[0] == "Japan"
        assert norm_nv("ANH") == "SAnh"
        assert norm_pos_nv("Hồ Sỹ Aanh") == "SAnh"
        assert norm_pos_nv("Anh Tuấn") is None and norm_pos_nv("Ánh") is None   # không vơ tên khác có chữ Anh

    def test_cross_market_credited_to_market_owner(self):
        # Sỹ Anh chốt 10/10/2026: camp cũ chưa đổi tên chạy lấn nước của team khác → người cầm nước đó.
        # 03/11/2026: Sỹ Anh cầm Đài từ tháng 10 (trước là Thương).
        assert MARKET_OWNER == {"Taiwan": "SAnh", "Singapore": "Thai", "UAE": "Loc", "Japan": "SAnh"}
        assert credited_marketer("Loc", "Taiwan") == "SAnh" and credited_marketer("Loc", "Singapore") == "Thai"
        assert credited_marketer("Thai", "Taiwan") == "SAnh" and credited_marketer("Thuong", "Singapore") == "Thai"
        # Đúng nước của team mình thì giữ nguyên — Đông Á gồm Đài + Nhật.
        assert credited_marketer("Loc", "UAE") == "Loc" and credited_marketer("Thang", "Japan") == "Thang"
        assert credited_marketer("Quynh", "Taiwan") == "Quynh" and credited_marketer("SAnh", "Japan") == "SAnh"
        assert credited_marketer("(không gán)", "Taiwan") == "(không gán)"

    def test_inactive_marketer_credited_to_owner_from_stop_date(self):
        # Sỹ Anh chốt 03/11/2026: Thương không chạy từ tháng 10 — tag POS "Thương Thương" (Thương tạo
        # đơn với vai sale) và camp cũ TW/THƯƠNG… từ 01/10 về người cầm nước; tháng 9 giữ tên Thương.
        assert credited_marketer("Thuong", "Taiwan", "2026-09-30") == "Thuong"
        assert credited_marketer("Thuong", "Japan", "2026-09-30") == "Thuong"
        assert credited_marketer("Thuong", "Singapore", "2026-09-30") == "Thai"   # lấn nước vẫn như cũ
        assert credited_marketer("Thuong", "Taiwan", "2026-10-01") == "SAnh"
        assert credited_marketer("Thuong", "Japan", "2026-10-08") == "SAnh"
        assert credited_marketer("Thuong", "UAE", "2026-11-03") == "Loc"
        assert credited_marketer("Thuong", "Taiwan") == "SAnh"                   # không ngày = số hiện tại
        assert credited_marketer("Quynh", "Taiwan", "2026-11-03") == "Quynh"

    def test_market_spellings(self):
        for name, market in (("SINGAPORE/LOC/x", "Singapore"), ("sing/LOC/x", "Singapore"),
                          ("SGP/LOC/PHI/075 - SETTS01/Lucky Silver Philippines/13-9", "Singapore"),
                          ("UAE/LOC/x", "UAE"), ("Dubai/LOC/x", "UAE"), ("TAIWAN/LOC/x", "Taiwan")):
            assert campaign_market(name)[0] == market, name

    def test_old_name_without_market_defaults_to_taiwan_and_flagged(self):
        assert campaign_market("Lộc/Philippine/050 - SET8/Catholic Essentials HK/3-9") == ("Taiwan", "mac_dinh")

    def test_market_in_middle_old_style(self):
        assert campaign_market("Tặng/TW/LOC/042/Page/2808") == ("Taiwan", "o_khac")

    def test_market_code_must_fill_whole_cell(self):
        # "Master Jewelry Gold - TW - 02" là tên trang có chữ TW, không phải ô nước.
        assert campaign_market("Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09")[1] == "mac_dinh"


class TestMarketStatus:
    def test_singapore_connected(self):
        assert RATE["Singapore"] == 20000 and MONEY_DIV["Singapore"] == 100

    def test_uae_has_exchange_rate(self):
        # Chốt 15/09/2026: 1 AED = 7.000đ. Số chia 100 chưa đo — phải khai cùng lúc với tỷ
        # giá: để trống thì ở đây ra 1 trong khi view chia 100.
        assert RATE["UAE"] == 7000 and MONEY_DIV["UAE"] == 100

    def test_all_markets_active(self):
        # Nhật nối shop 09/10/2026.
        # Việt Nam nối shop 11/11/2026 (hạt giống, VND).
        assert ACTIVE_MARKETS == ["Taiwan", "Singapore", "UAE", "Japan", "Vietnam"]

    def test_currency_symbols(self):
        assert CURRENCY_SYMBOL == {"Taiwan": "NT$", "Singapore": "S$", "UAE": "AED", "Japan": "¥", "Vietnam": "đ"}

    def test_all_markets_exempt_from_test_rule(self):
        assert NO_TEST_MARKETS == {"Taiwan", "Singapore", "UAE", "Japan", "Vietnam"}
        assert is_test("SG/LOC/PHI/TEST/Page/1509", "Singapore") is False


class TestCogs:
    def test_convert_rmb_by_configured_rate(self):
        assert COST_RATE_RMB_VND == 3860
        assert cost_price_vnd("002") == round(RULES["products"]["002"]["cost_price_rmb"] * 3860)

    def test_unknown_sku_returns_none_not_zero(self):
        assert cost_price_vnd("khong-co-ma-nay") is None


class TestVietnam:
    """Mở Việt Nam 11/11/2026: "VN" vừa là mã nước vừa là TỆP KHÁCH người Việt ở Đài —
    chỉ ô ĐẦU mới là nước."""

    def test_vn_first_segment_is_vietnam(self):
        assert campaign_market("VN/THÁI/VN/VẠN THỌ / Hạt Giống Nông Nghiệp F1/10-11") == ("Vietnam", "o_dau")
        assert campaign_market("VN/THÁI/HOA VẠN THỌ/Kho Hạt Giống Việt/04-11") == ("Vietnam", "o_dau")

    def test_vn_in_other_segment_stays_audience(self):
        # Camp Đài nhắm người Việt ở Đài: vẫn là Đài.
        assert campaign_market("TW/THUONG/VN/TEST/Trang Sức Vàng Thái/14-09")[0] == "Taiwan"
        # Tên kiểu cũ không ghi nước: VN ở ô 2 KHÔNG được biến thành Việt Nam.
        assert campaign_market("THUONG/VN/042/Trang/1-9") == ("Taiwan", "mac_dinh")
