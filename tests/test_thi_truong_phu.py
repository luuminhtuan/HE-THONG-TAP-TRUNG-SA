"""
Thị trường nhập ở /admin → Thị trường (04/11/2026) — phủ lên config/talpha_rules.json.

Chạy: TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_thi_truong_phu.py -q

Canh ba chỗ làm sai số nếu trượt:
  • bản Python phủ khác bản dashboard / bot → Sheet, view và dashboard ra ba con số khác nhau
    (bộ dữ liệu chung tests/fixtures/thi_truong_phu.json);
  • nước thêm trên trang không vào CASE tỷ giá / số chia của view Postgres → doanh thu nước đó ra 0
    trên mọi tab đọc view (ELSE 0.0), hoặc luật đổi mà view không dựng lại;
  • vòng ghi Sheet đọc luật gốc, bỏ qua nước mới → Sheet thiếu cả một nước.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sync.core.business_rules import shop_pos_tu_markets  # noqa: E402
from sync.core.thi_truong import doc_phu, phu_luat  # noqa: E402

BO = json.loads((ROOT / "tests" / "fixtures" / "thi_truong_phu.json").read_text(encoding="utf-8"))

THAI_LAN = {"markets": {"Thailand": {
    "shop_label": "TH", "shop_id": "123456", "currency": "THB", "currency_symbol": "฿",
    "rate_vnd": 700, "pos_money_divisor": 1, "display": "Thái Lan", "status": "dang_ban",
    "tokens": ["TH", "THAI"], "team": "dong_nam_a"}}}


def _khong_ghi_chu(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


class TestBoDuLieuChung:
    def test_ra_dung_ket_qua_chung_cua_ba_ban(self):
        ra = phu_luat(BO["luat"], BO["phu"])
        md = BO["mong_doi"]
        assert _khong_ghi_chu(ra["markets"]) == md["markets"]
        assert _khong_ghi_chu(ra["market_aliases"]) == md["market_aliases"]
        assert ra["camp_market_tokens"] == md["camp_market_tokens"]
        assert {k: t["markets"] for k, t in ra["access"]["teams"].items()} == md["teams"]

    def test_khong_sua_luat_goc_truyen_vao(self):
        truoc = json.dumps(BO["luat"], sort_keys=True)
        phu_luat(BO["luat"], BO["phu"])
        assert json.dumps(BO["luat"], sort_keys=True) == truoc

    def test_khong_co_file_phu_thi_y_nguyen(self):
        assert phu_luat(BO["luat"], None) == BO["luat"]


class TestDocFilePhu:
    def test_chua_co_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(tmp_path / "khong_co.json"))
        assert doc_phu() is None

    def test_file_hong_thi_bo_qua_khong_sap(self, tmp_path, monkeypatch, capsys):
        p = tmp_path / "thi_truong.json"
        p.write_text("{hỏng", encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        assert doc_phu() is None
        assert "hỏng định dạng" in capsys.readouterr().err


class TestVanTayView:
    """Sync tự dựng lại view khi SQL sinh từ luật đổi (sync/core/pg_view.py băm câu SQL đã sinh)."""

    def _van_tay(self, tmp_path, monkeypatch, phu):
        p = tmp_path / "thi_truong.json"
        p.write_text(json.dumps(phu or {}, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        from sync.core.pg_view import sinh_tat_ca
        return sinh_tat_ca()[1]

    def test_doi_ty_gia_so_chia_trang_thai_hay_them_nuoc_thi_doi(self, tmp_path, monkeypatch):
        goc = self._van_tay(tmp_path, monkeypatch, None)
        assert self._van_tay(tmp_path, monkeypatch, {"markets": {"Singapore": {"rate_vnd": 19000}}}) != goc
        assert self._van_tay(tmp_path, monkeypatch, {"markets": {"Singapore": {"pos_money_divisor": 1}}}) != goc
        assert self._van_tay(tmp_path, monkeypatch, THAI_LAN) != goc

    def test_doi_ten_hien_thi_thi_khong_dung_lai_view(self, tmp_path, monkeypatch):
        goc = self._van_tay(tmp_path, monkeypatch, None)
        assert self._van_tay(tmp_path, monkeypatch, {"markets": {"Singapore": {"display": "Sing"}}}) == goc


class TestNuocMoiVaoMoiNoi:
    def test_sync_keo_don_shop_moi(self):
        luat = phu_luat(json.loads((ROOT / "config" / "talpha_rules.json").read_text(encoding="utf-8")), THAI_LAN)
        ds = {s["label"]: s for s in shop_pos_tu_markets(luat["markets"], {"TALPHA_POSCAKE_TH_KEY": "k-th"})}
        assert ds["TH"]["shop_id"] == "123456" and ds["TH"]["key"] == "k-th" and ds["TH"]["keo"] is True
        assert {"TW", "SG", "AE", "JP"} <= set(ds)

    def test_view_co_ty_gia_va_so_chia_nuoc_moi(self, tmp_path, monkeypatch):
        # Chỉ dựng câu SQL (hàm thuần của bộ dựng view) — không kết nối Postgres.
        p = tmp_path / "thi_truong.json"
        p.write_text(json.dumps(THAI_LAN, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        from sync.core import pg_view as D
        case, known = D.fx_sql()
        assert "WHEN 'TH' THEN 700.0" in case and "'TH'" in known
        assert "WHEN 'TW' THEN 800.0" in case          # nước cũ vẫn nguyên
        assert "WHEN 'TH' THEN 1" in D.money_divisor_sql()

    def test_sheet_doc_luat_da_phu(self, tmp_path, monkeypatch):
        p = tmp_path / "thi_truong.json"
        p.write_text(json.dumps(THAI_LAN, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        monkeypatch.setenv("TALPHA_RULES", str(ROOT / "config" / "talpha_rules.json"))
        spec = importlib.util.spec_from_file_location("talpha_rules_phu", ROOT / "ops" / "talpha_reports" / "talpha_rules.py")
        R = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(R)
        assert R.RATE["Thailand"] == 700 and R.MONEY_DIV["Thailand"] == 1
        assert "Thailand" in R.ALLM and "Thailand" in R.DANG_BAN
        assert R.campaign_market("TH/LOC/PHI/042-BLACK/Trang/2808") == ("Thailand", "o_dau")
        assert R.campaign_market("TW/LOC/PHI/042-BLACK/Trang/2808")[0] == "Taiwan"
