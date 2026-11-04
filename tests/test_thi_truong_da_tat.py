"""
Tắt một thị trường (status "da_tat", 04/11/2026) — ngừng kéo số mới, GIỮ lịch sử.

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

from sync.core.business_rules import shop_pos_tu_markets  # noqa: E402
from sync.core.pg_writer import sql_dung_lai_don  # noqa: E402

MARKETS = {
    "Taiwan": {"shop_label": "TW", "shop_id": "1022091930", "currency": "TWD",
               "rate_vnd": 800, "pos_money_divisor": 1, "status": "da_tat"},
    "Singapore": {"shop_label": "SG", "shop_id": "715135541", "currency": "SGD",
                  "rate_vnd": 20000, "pos_money_divisor": 100, "status": "dang_ban"},
    "Thailand": {"shop_label": "TH", "shop_id": "", "currency": "THB",
                 "rate_vnd": None, "pos_money_divisor": None, "status": "sap_chay"},
}
ENV = {"TALPHA_POSCAKE_SG_KEY": "k-sg"}


class TestDanhSachShop:
    def test_shop_da_tat_van_trong_danh_sach_nhung_khong_keo(self):
        ds = {s["label"]: s for s in shop_pos_tu_markets(MARKETS, ENV)}
        assert ds["TW"]["keo"] is False and ds["TW"]["trang_thai"] == "da_tat"
        assert ds["SG"]["keo"] is True and ds["SG"]["key"] == "k-sg"

    def test_nuoc_sap_chay_chua_co_shop_thi_bo(self):
        assert "TH" not in {s["label"] for s in shop_pos_tu_markets(MARKETS, ENV)}

    def test_nuoc_sap_chay_da_khai_shop_thi_chua_keo(self):
        # Thêm nước trên trang có thể khai shop trước khi bán (04/11/2026) — chưa được kéo đơn.
        mk = {**MARKETS, "Thailand": {**MARKETS["Thailand"], "shop_id": "123456"}}
        ds = {s["label"]: s for s in shop_pos_tu_markets(mk, ENV)}
        assert ds["TH"]["keo"] is False and ds["TH"]["trang_thai"] == "sap_chay"

    def test_dung_lai_bang_don_giu_don_cu_cua_nuoc_da_tat(self):
        # talpha_sync truyền shop_ids = MỌI shop trong danh sách → câu dựng lại phải giữ shop Đài.
        ids = [s["shop_id"] for s in shop_pos_tu_markets(MARKETS, ENV)]
        sql = sql_dung_lai_don("sale_order", ids)
        assert "'1022091930'" in sql and "'715135541'" in sql


class TestLuatPhiaSheet:
    def test_nuoc_da_tat_giu_ty_gia_so_chia_va_lich_su(self, tmp_path, monkeypatch):
        cfg = json.load(open(ROOT / "config" / "talpha_rules.json", encoding="utf-8"))
        cfg["markets"]["Taiwan"]["status"] = "da_tat"
        p = tmp_path / "talpha_rules.json"
        p.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_RULES", str(p))
        spec = importlib.util.spec_from_file_location(
            "talpha_rules_da_tat", ROOT / "ops" / "talpha_reports" / "talpha_rules.py")
        R = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(R)
        assert R.DA_TAT == ["Taiwan"]
        assert "Taiwan" not in R.DANG_BAN
        assert "Taiwan" in R.ALLM                       # báo cáo những ngày Đài còn chạy vẫn có Đài
        assert R.RATE["Taiwan"] == 800 and R.MONEY_DIV["Taiwan"] == 1
        assert R.campaign_market("TW/THUONG/PHI/042-BLACK/Trang/2808")[0] == "Taiwan"
