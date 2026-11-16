"""
Tắt một thị trường (status "disabled", 04/11/2026) — ngừng kéo số mới, GIỮ lịch sử.

Chạy: TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_thi_truong_da_tat.py -q

Canh chỗ làm mất dữ liệu nếu trượt: bảng đơn sạch dựng lại mỗi giờ CHỈ từ những shop có trong
danh sách (pg_writer._loc_shop). Bỏ shop của nước đã tắt khỏi danh sách là đơn cũ của nước đó
biến khỏi mọi báo cáo ngay vòng sync sau.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sync.core.business_rules import pos_shops_from_markets  # noqa: E402
from sync.core.pg_writer import sql_rebuild_orders  # noqa: E402

MARKETS = {
    "Taiwan": {"shop_label": "TW", "shop_id": "1022091930", "currency": "TWD",
               "rate_vnd": 800, "pos_money_divisor": 1, "status": "disabled"},
    "Singapore": {"shop_label": "SG", "shop_id": "715135541", "currency": "SGD",
                  "rate_vnd": 20000, "pos_money_divisor": 100, "status": "active"},
    "Thailand": {"shop_label": "TH", "shop_id": "", "currency": "THB",
                 "rate_vnd": None, "pos_money_divisor": None, "status": "upcoming"},
}
ENV = {"TALPHA_POSCAKE_SG_KEY": "k-sg"}


class TestShopList:
    def test_disabled_shop_listed_but_not_fetched(self):
        ds = {s["label"]: s for s in pos_shops_from_markets(MARKETS, ENV)}
        assert ds["TW"]["fetch_orders"] is False and ds["TW"]["status"] == "disabled"
        assert ds["SG"]["fetch_orders"] is True and ds["SG"]["key"] == "k-sg"

    def test_upcoming_market_without_shop_skipped(self):
        assert "TH" not in {s["label"] for s in pos_shops_from_markets(MARKETS, ENV)}

    def test_upcoming_market_with_shop_not_fetched_yet(self):
        # Thêm nước trên trang có thể khai shop trước khi bán (04/11/2026) — chưa được kéo đơn.
        mk = {**MARKETS, "Thailand": {**MARKETS["Thailand"], "shop_id": "123456"}}
        ds = {s["label"]: s for s in pos_shops_from_markets(mk, ENV)}
        assert ds["TH"]["fetch_orders"] is False and ds["TH"]["status"] == "upcoming"

    def test_rebuild_orders_keeps_disabled_market_orders(self):
        # talpha_sync truyền shop_ids = MỌI shop trong danh sách → câu dựng lại phải giữ shop Đài.
        ids = [s["shop_id"] for s in pos_shops_from_markets(MARKETS, ENV)]
        sql = sql_rebuild_orders("sale_order", ids)
        assert "'1022091930'" in sql and "'715135541'" in sql


class TestSheetSideRules:
    def test_disabled_market_keeps_rate_divisor_and_history(self, tmp_path, monkeypatch):
        cfg = json.load(open(ROOT / "config" / "talpha_rules.json", encoding="utf-8"))
        cfg["markets"]["Taiwan"]["status"] = "disabled"
        p = tmp_path / "talpha_rules.json"
        p.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_RULES", str(p))
        spec = importlib.util.spec_from_file_location(
            "talpha_rules_da_tat", ROOT / "ops" / "talpha_reports" / "talpha_rules.py")
        R = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(R)
        assert R.DISABLED_MARKETS == ["Taiwan"]
        assert "Taiwan" not in R.ACTIVE_MARKETS
        assert "Taiwan" in R.ALLM                       # báo cáo những ngày Đài còn chạy vẫn có Đài
        assert R.RATE["Taiwan"] == 800 and R.MONEY_DIV["Taiwan"] == 1
        assert R.campaign_market("TW/THUONG/PHI/042-BLACK/Trang/2808")[0] == "Taiwan"
