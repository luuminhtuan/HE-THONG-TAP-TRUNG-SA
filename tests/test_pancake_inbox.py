"""Hộp thư Pancake — phần thuần (sync/core/pancake_inbox.py): đọc dữ liệu Pancake chịu nhiều dạng, lật trang, page → nước.

Chạy: TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_pancake_inbox.py
"""
from datetime import datetime, timezone

from sync.core import pancake_inbox as P

UTC = timezone.utc


class TestParse:
    def test_ts_utc_without_zone(self):
        assert P.parse_ts("2026-11-16T09:08:04.102000") == datetime(2026, 11, 16, 9, 8, 4, 102000, tzinfo=UTC)
        assert P.parse_ts("2026-11-16T16:08:04+07:00") == datetime(2026, 11, 16, 9, 8, 4, tzinfo=UTC)
        assert P.parse_ts(1794554848) == datetime.fromtimestamp(1794554848, tz=UTC)
        assert P.parse_ts("") is None and P.parse_ts("không phải ngày") is None

    def test_conversation_with_from_and_phones(self):
        c = P.normalize_conversation({
            "id": "1234_5678", "type": "INBOX", "from": {"id": "5678", "name": "Nguyễn Văn A"},
            "recent_phone_numbers": [{"phone_number": "0912 345 678"}, {"phone_number": "0912345678"}],
            "snippet": "Còn hàng không shop?", "tags": [{"id": 3, "text": "Chốt"}],
            "inserted_at": "2026-11-15T01:00:00", "updated_at": "2026-11-16T09:00:00",
        })
        assert c["conversation_id"] == "1234_5678" and c["customer_name"] == "Nguyễn Văn A" and c["customer_id"] == "5678"
        assert c["phone_numbers"] == ["0912345678"]
        assert c["tags"] == ["Chốt"] and c["snippet"] == "Còn hàng không shop?"
        assert c["updated_at"] == datetime(2026, 11, 16, 9, tzinfo=UTC)

    def test_conversation_customers_fallback_and_missing_fields(self):
        c = P.normalize_conversation({"id": 9, "customers": [{"name": "B", "fb_id": "77"}],
                                      "last_message": {"message": "hi"}, "inserted_at": "2026-11-10T00:00:00"})
        assert (c["customer_name"], c["customer_id"], c["snippet"]) == ("B", "77", "hi")
        assert c["updated_at"] == datetime(2026, 11, 10, tzinfo=UTC), "thiếu updated_at → dùng inserted_at"
        assert c["phone_numbers"] == [] and c["tags"] == []

    def test_message_from_page_attachments_html(self):
        m = P.normalize_message({"id": "m1", "from": {"id": "1234", "name": "Shop"}, "message": "<div>Dạ <b>còn</b> ạ</div>",
                                 "attachments": [{"type": "image", "payload": {"url": "https://x/a.jpg"}}, {"type": "sticker"}],
                                 "inserted_at": "2026-11-16T09:01:00"}, page_id="1234")
        assert m["from_page"] is True and m["body"] == "Dạ còn ạ"
        assert m["attachments"] == [{"type": "image", "url": "https://x/a.jpg", "name": None}]
        k = P.normalize_message({"id": "m2", "from": {"id": "5678", "name": "A"}, "original_message": "ok"}, page_id="1234")
        assert k["from_page"] is False and k["body"] == "ok" and k["sent_at"] is None


class TestPaging:
    def test_stop_when_batch_reaches_floor(self):
        floor = datetime(2026, 11, 16, 8, tzinfo=UTC)
        newer = [{"updated_at": datetime(2026, 11, 16, 9, tzinfo=UTC)}]
        mixed = newer + [{"updated_at": datetime(2026, 11, 16, 7, tzinfo=UTC)}]
        assert P.batch_reaches(newer, floor) is False
        assert P.batch_reaches(mixed, floor) is True
        assert P.batch_reaches([], floor) is True, "hết hội thoại"


class TestPageMarket:
    def test_camp_page_name_wins_then_suffix_code(self):
        pages = [{"id": 1, "name": "𝑳𝒖𝒙𝒆𝒐𝒓𝒂 Gold Jewelry JP"}, {"id": 2, "name": "Lucky Charm Store SG"},
                 {"id": 3, "name": "Prime Leather Japan"}, {"id": 4, "name": "Shop chưa chạy"}]
        camp_pages = [("Luxeora Gold Jewelry JP", "JP"), ("luxeora gold jewelry jp", "JP"), ("Luxeora Gold Jewelry JP", "TW")]
        m = P.page_market_map(pages, camp_pages, ["TW", "SG", "AE", "JP", "VN"])
        assert m == {"1": "JP", "2": "SG"}, "Japan ở đuôi là tên hàng, không phải mã nước; page không camp, không mã → không gán"
