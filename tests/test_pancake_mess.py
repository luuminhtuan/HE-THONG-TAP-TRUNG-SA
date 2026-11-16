"""
Tin nhắn Nhật lấy từ Pancake cho Sheet (Sỹ Anh yêu cầu 09/10/2026) — Meta không báo mess ở Nhật.

Chạy: TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_pancake_mess.py -q
Mẫu hội thoại đúng dạng /api/v1/pages/{id}/conversations trả về ngày 09/10/2026 (UTC không múi).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ops" / "talpha_reports"))

import pancake_mess as P  # noqa: E402
from talpha_rules import MESS_PANCAKE, parse_camp_product, campaign_market  # noqa: E402

CONVERSATIONS = [
    {"id": "a", "type": "INBOX", "inserted_at": "2026-10-08T22:39:09.188", "updated_at": "2026-10-09T03:27:02"},
    {"id": "b", "type": "INBOX", "inserted_at": "2026-10-09T01:41:00", "updated_at": "2026-10-09T06:11:00"},
    {"id": "c", "type": "COMMENT", "inserted_at": "2026-10-08T23:11:24", "updated_at": "2026-10-08T23:11:14"},
    {"id": "d", "type": "INBOX", "inserted_at": "2026-10-08T06:08:39", "updated_at": "2026-10-09T07:29:02"},
    {"id": "b", "type": "INBOX", "inserted_at": "2026-10-09T01:41:00", "updated_at": "2026-10-09T06:11:00"},
]


def test_japan_messages_from_pancake():
    assert MESS_PANCAKE == {"Japan"}


def test_count_new_messages_by_vn_date_skip_comments_and_duplicates():
    assert P.count_by_date(CONVERSATIONS, "2026-10-01", "2026-10-31") == {"2026-10-09": 2, "2026-10-08": 1}
    assert P.count_by_date(CONVERSATIONS, "2026-10-09", "2026-10-09") == {"2026-10-09": 2}


def test_batch_exhausted_when_all_updated_before_cutoff():
    assert P.is_batch_exhausted(CONVERSATIONS, "2026-10-01") is False
    assert P.is_batch_exhausted([{"id": "x", "updated_at": "2026-09-30T16:59:00"}], "2026-10-01") is True
    assert P.is_batch_exhausted([], "2026-10-01") is True


def test_market_page_only_by_shop_code_suffix():
    assert P.is_market_page("Lucky Charm JP", "JP")
    assert not P.is_market_page("𝑷𝒓𝒊𝒎𝒆 𝑳𝒆𝒂𝒕𝒉𝒆𝒓 𝑱𝒂𝒑𝒂𝒏", "JP")      # page sản phẩm bán ở Đài
    assert not P.is_market_page("GoutEase Advance Herbal Spray Japan", "JP")


def test_assign_messages_to_top_spender_and_no_spend_days():
    page_counts = {P.normalize_page_name("Lucky Charm JP"): {"ten": "Lucky Charm JP", "ngay": {"2026-10-08": 6, "2026-10-10": 2}},
          P.normalize_page_name("Trang Moi JP"): {"ten": "Trang Moi JP", "ngay": {"2026-10-09": 3}}}
    ad_rows = [
        ("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-08", 162262),
        ("JP/THƯƠNG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-08", 5000),
        ("TW/LỘC/PHI/042/Lucky Charm JP/26-9", "2026-10-08", 999999),      # camp nước khác — không tính
    ]
    assigned, unassigned = P.assign_to_campaigns(page_counts, ad_rows, lambda cn: campaign_market(cn)[0] == "Japan", lambda cn: parse_camp_product(cn)[1])
    assert assigned == {("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-08"): 6,
                   ("JP/THANG/PHI/002-ATTL/Lucky Charm JP/08-10", "2026-10-10"): 2}   # ngày không tiêu → camp trước đó
    assert unassigned == {"Trang Moi JP": 3}
