"""
Tab sản phẩm trong file Sheet: đọc tên campaign, nối đơn POS → camp THEO NGUỒN ĐƠN (tên page).

Chạy: python3 -m pytest tests/test_talpha_san_pham_theo_page.py -q

16/09/2026 Sỹ Anh mở tab "040 - VONGVANG1" của Lộc: có tiền ads, 0 đơn — "phải tính theo
page chứ, theo luồng nghiệp vụ cũ". Soi ra cả tháng 9 mọi đơn rơi vào tab "(khác)" (luồng cũ
nối đơn qua SỐ page trong tên camp, tên bây giờ chỉ ghi TÊN trang), kèm hai lỗi đọc ô làm
mọc tab "PHI", "INDO" (tệp khách) và "4-9 TEST", "7-9" (ngày). Tên campaign dưới đây là tên
THẬT đang chạy tháng 9/2026.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

from talpha_rules import (  # noqa: E402
    parse_camp_product, normalize_page_name, build_page_index, find_campaign_by_page,
    camp_page_cells, build_page_tab_names, order_tab_name,
)


class TestProductFromCampaignName:
    def test_standard_name_with_market_skips_audience_cell(self):
        # Lỗi cũ: ô ngay sau marketer (tệp khách) bị lấy làm sản phẩm → tab "PHI" 4,98tr ads.
        assert parse_camp_product("TW/LOC/PHI/072 - DENTAL/DOC Alipion-Tooth ARMOR TW/8-9")[:2] == \
            ("072 - DENTAL", "DOC Alipion-Tooth ARMOR TW")
        assert parse_camp_product("TW/LOC/INDO/042 - BLACK/𝑰𝒕𝒂𝒍𝒚 𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓/5-9")[0] == "042 - BLACK"
        assert parse_camp_product("TW/THÁI/VIỆT/GIÀY g_c05 /EZMAN Sneaker - TW/ 06/09")[0] == "GIÀY g_c05"
        assert parse_camp_product("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST")[0] == "VÒNG MAY MẮN"
        assert parse_camp_product("SGP/LOC/PHI/075 - SETTS01/Lucky Silver Philippines/13-9")[0] == "075 - SETTS01"

    def test_old_name_without_market_still_works(self):
        assert parse_camp_product("Lộc/Philippine/040 - VONGVANG1/𝑻𝒂𝒊𝒘𝒂𝒏 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/28-8")[:2] == \
            ("040 - VONGVANG1", "𝑻𝒂𝒊𝒘𝒂𝒏 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕")
        assert parse_camp_product("Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09")[0] == "SET KC"
        assert parse_camp_product("THƯƠNG/VN/DAY CHUYEN RONG VANG/Trang Sức Vàng Thái/1226125240593692/4-9 TEST")[0] == \
            "DAY CHUYEN RONG VANG"

    def test_page_id_after_page_name_keeps_date_out_of_product(self):
        # Lỗi cũ: lấy ô SAU con số làm sản phẩm → tab "4-9 TEST" (Thắng), "7-9" (Thương).
        sp, page, page_id = parse_camp_product("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST")
        assert (sp, page_id) == ("VÒNG MAY MẮN", "1258963223972395")
        sp, _, page_id = parse_camp_product("TW/THUONG/PHI/TEST/𝙻𝚞𝚌𝚔𝚢 𝙲𝚑𝚊𝚛𝚖 𝙿𝙷/1306085275928527/7-9")
        assert (sp, page_id) == ("TEST · 𝙻𝚞𝚌𝚔𝚢 𝙲𝚑𝚊𝚛𝚖 𝙿𝙷", "1306085275928527")

    def test_gcc_style_page_id_in_product_cell_uses_page_name(self):
        # Luồng cũ: tên có số page đứng TRƯỚC tên trang → sản phẩm chính là trang.
        assert parse_camp_product("TW/Loc/1303370732848505/Taiwan Prime Leather/2808")[::2] == \
            ("Taiwan Prime Leather", "1303370732848505")

    def test_four_digit_date_not_mistaken_for_page_id(self):
        assert parse_camp_product("TW/LOC/PHI/042-BLACK/TaiwanPrimeLeather/2808")[2] is None

    def test_test_camp_split_by_page(self):
        assert parse_camp_product("TW/LOC/PHI/TEST/Saqrr gold Jewelry Taiwan/14-9")[0] == "TEST · Saqrr gold Jewelry Taiwan"

    def test_unrecognized_marketer(self):
        assert parse_camp_product("Ai do/khong ro/xyz") == (None, None, None)


class TestMatchOrderSourceToCampaignPage:
    """Luật Sỹ Anh chốt 17/09/2026: nguồn đơn POS → ô tên page trong tên camp → camp."""
    ADS = [
        ("SGP/LOC/PHI/040/Lucky Silver Philippines/13-9", "2026-09-13", 300000),
        ("SGP/LOC/PHI/040/𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/15-9", "2026-09-15", 200000),
        ("TW/THAI/INDO/SET KC/Master Jewelry Gold - TW - 02/09", "2026-09-02", 100000),
        ("TW/THAI/PHI/Jewelry GJ International - TW - 05/09", "2026-09-05", 500000),
        # một page, hai người nối nhau: Thắng đầu tháng, Thương từ 14/09
        ("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST", "2026-09-04", 400000),
        ("TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST", "2026-09-10", 300000),
        ("TW/THUONG/PHI/071/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/14-9", "2026-09-14", 250000),
        ("Ai do/khong ro/xyz", "2026-09-14", 999),
    ]
    CM = build_page_index(ADS)

    def test_normalize_page_name(self):
        assert normalize_page_name("𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕") == "saudi golden bracelet"
        assert normalize_page_name("  Master Jewelry Gold&Diamond - TW ") == "master jewelry gold diamond tw"
        assert normalize_page_name(None) == ""

    def test_exact_page_name(self):
        assert find_campaign_by_page("Lucky Silver Philippines", "2026-09-16", self.CM) == \
            ("SGP/LOC/PHI/040/Lucky Silver Philippines/13-9", "dung_ten")
        # POS và camp khác kiểu chữ vẫn khớp
        assert find_campaign_by_page("Saudi Golden Bracelet", "2026-09-16", self.CM)[1] == "dung_ten"

    def test_date_attached_to_page_name(self):
        assert find_campaign_by_page("Master Jewelry Gold - TW", "2026-09-03", self.CM) == \
            ("TW/THAI/INDO/SET KC/Master Jewelry Gold - TW - 02/09", "dau_ten")

    def test_page_name_in_product_cell(self):
        assert find_campaign_by_page("Jewelry GJ International", "2026-09-06", self.CM) == \
            ("TW/THAI/PHI/Jewelry GJ International - TW - 05/09", "lech_o")

    def test_multi_camp_page_picks_camp_running_on_order_date(self):
        early_camp = "TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST"
        late_camp = "TW/THUONG/PHI/071/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/14-9"
        assert find_campaign_by_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-10", self.CM)[0] == early_camp
        assert find_campaign_by_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-12", self.CM)[0] == early_camp    # ngày có tiền gần nhất trước đó
        assert find_campaign_by_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-15", self.CM)[0] == late_camp

    def test_multi_camp_page_prefers_order_ad_campaign(self):
        thuong = "TW/THUONG/PHI/071/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/14-9"
        assert find_campaign_by_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-10", self.CM, ad_campaign=thuong)[0] == thuong

    def test_order_before_all_camps_takes_top_spender(self):
        thang = "TW/THẮNG /TỆP PHI/VÒNG MAY MẮN/𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖/1258963223972395/4-9 TEST"
        assert find_campaign_by_page("𝐁𝐢𝐲𝐚𝐲𝐚 𝐓𝐖", "2026-09-01", self.CM)[0] == thang

    def test_only_camps_in_shop_market(self):
        # 17/09/2026: một page chạy cả camp Đài lẫn Singapore — đơn shop Đài không được nối
        # vào camp Singapore (đơn Đài #381 từng làm Lộc ra 3 đơn ngày 15/09, POS chỉ 2).
        cm = build_page_index([
            ("SGP/LOC/PHI/040/Lucky Silver Philippines/13-9", "2026-09-13", 300000),
            ("TW/THAI/PHI/040/Lucky Silver Philippines/14-9", "2026-09-14", 100000),
        ])
        assert find_campaign_by_page("Lucky Silver Philippines", "2026-09-15", cm, market="Taiwan")[0] == \
            "TW/THAI/PHI/040/Lucky Silver Philippines/14-9"
        assert find_campaign_by_page("Lucky Silver Philippines", "2026-09-15", cm, market="Singapore")[0] == \
            "SGP/LOC/PHI/040/Lucky Silver Philippines/13-9"
        # Page chỉ có camp nước khác → không khớp, không nhận nhầm.
        assert find_campaign_by_page("Lucky Silver Philippines", "2026-09-15", self.CM, market="Taiwan") == \
            (None, "khong_khop")

    def test_no_match_and_no_source(self):
        assert find_campaign_by_page("HongKong Golden Bracelet", "2026-09-10", self.CM) == (None, "khong_khop")
        assert find_campaign_by_page("", "2026-09-10", self.CM) == (None, "khong_co_nguon")
        assert find_campaign_by_page(None, "2026-09-10", self.CM) == (None, "khong_co_nguon")


class TestTabNameByPage:
    """Sỹ Anh chốt 17/09/2026: mỗi page một tab, đặt theo tên page (tab "040" gộp hai page khác nhau)."""
    POS = ["Lucky Silver Philippines", "Lucky Silver Philippines", "𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕",
           "Lumora Jewelry Store", "Jewelry GJ International", "Master Jewelry Gold - TW",
           "Master Jewelry Gold&Diamond"]
    POS_NAMES, CAMP_TAB = build_page_tab_names(POS, [
        "SGP/LOC/PHI/040/Lucky Silver Philippines/13-9",
        "SGP/LOC/PHI/040/𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/15-9",
        "TW/THAI/INDO/040 - VONGVANG1/Lumora Jewelry Store - 05/9 - 2",
        "TW/THÁI/INDO/040 - VONGVANG1/ Lumora Jewelry Store/31/08 vd2",
        "TW/THAI/PHI/Jewelry GJ International - TW - 05/09",
        "Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09",
        "Thainx/INDO/SET 13/Master Jewelry Gold&Diamond - 03/09 -02",
        "Thainx/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry - 27/08",
        "TW/THÁI/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry/ 01/09",
        "TW/LOC/PHI/𝑻𝒉𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑨𝒕𝒆𝒍𝒊𝒆𝒓 𝑺𝒉𝒐𝒑/13-9/TEST",
        "TW/Loc/1303370732848505/Taiwan Prime Leather/2808",
        "TW/THÁI/VIỆT/Vòng/Vượng Khí Các - TW - 25/09",
        "Ai do/khong ro/xyz",
    ])

    def test_two_pages_same_product_are_two_tabs(self):
        assert self.CAMP_TAB["SGP/LOC/PHI/040/Lucky Silver Philippines/13-9"] == "Lucky Silver Philippines"
        assert self.CAMP_TAB["SGP/LOC/PHI/040/𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕/15-9"] == "𝑺𝒂𝒖𝒅𝒊 𝑮𝒐𝒍𝒅𝒆𝒏 𝑩𝒓𝒂𝒄𝒆𝒍𝒆𝒕"

    def test_page_name_with_date_maps_to_pos_page_tab(self):
        assert self.CAMP_TAB["TW/THAI/INDO/040 - VONGVANG1/Lumora Jewelry Store - 05/9 - 2"] == "Lumora Jewelry Store"
        assert self.CAMP_TAB["TW/THÁI/INDO/040 - VONGVANG1/ Lumora Jewelry Store/31/08 vd2"] == "Lumora Jewelry Store"

    def test_multiple_pos_matches_take_most_specific_name(self):
        assert self.CAMP_TAB["Thainx/INDO/SET KC/Master Jewelry Gold - TW - 02/09"] == "Master Jewelry Gold - TW"
        assert self.CAMP_TAB["Thainx/INDO/SET 13/Master Jewelry Gold&Diamond - 03/09 -02"] == "Master Jewelry Gold&Diamond"

    def test_page_name_written_in_product_cell(self):
        assert self.CAMP_TAB["TW/THAI/PHI/Jewelry GJ International - TW - 05/09"] == "Jewelry GJ International"
        assert self.CAMP_TAB["TW/LOC/PHI/𝑻𝒉𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑨𝒕𝒆𝒍𝒊𝒆𝒓 𝑺𝒉𝒐𝒑/13-9/TEST"] == "𝑻𝒉𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑨𝒕𝒆𝒍𝒊𝒆𝒓 𝑺𝒉𝒐𝒑"

    def test_page_without_pos_orders_uses_camp_name_and_merges_variants(self):
        assert self.CAMP_TAB["Thainx/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry - 27/08"] == "LuxeGold Jewelry"
        assert self.CAMP_TAB["TW/THÁI/Philippine/SET KIM CƯƠNG/ LuxeGold Jewelry/ 01/09"] == "LuxeGold Jewelry"
        assert self.CAMP_TAB["TW/Loc/1303370732848505/Taiwan Prime Leather/2808"] == "Taiwan Prime Leather"
        # ngày "25/09" bị dấu / cắt, "25" dính đuôi tên page
        assert self.CAMP_TAB["TW/THÁI/VIỆT/Vòng/Vượng Khí Các - TW - 25/09"] == "Vượng Khí Các - TW"

    def test_camp_with_unrecognized_marketer(self):
        assert self.CAMP_TAB["Ai do/khong ro/xyz"] is None
        assert camp_page_cells("Ai do/khong ro/xyz") == (None, [])

    def test_order_tab_name_uses_most_common_pos_spelling(self):
        assert order_tab_name(" lucky silver PHILIPPINES", self.POS_NAMES) == "Lucky Silver Philippines"
        assert order_tab_name("Page Lạ Chưa Gặp", self.POS_NAMES) == "Page Lạ Chưa Gặp"
        assert order_tab_name("", self.POS_NAMES) is None
        assert order_tab_name(None, self.POS_NAMES) is None
