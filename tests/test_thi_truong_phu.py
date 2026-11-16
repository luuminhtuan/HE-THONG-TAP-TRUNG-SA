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

from sync.core.business_rules import pos_shops_from_markets  # noqa: E402
from sync.core.thi_truong import load_market_overrides, apply_market_overrides  # noqa: E402

FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "thi_truong_phu.json").read_text(encoding="utf-8"))

THAILAND = {"markets": {"Thailand": {
    "shop_label": "TH", "shop_id": "123456", "currency": "THB", "currency_symbol": "฿",
    "rate_vnd": 700, "pos_money_divisor": 1, "display": "Thái Lan", "status": "dang_ban",
    "tokens": ["TH", "THAI"], "team": "dong_nam_a"}}}


def _strip_comments(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


class TestSharedFixture:
    def test_matches_shared_result_of_all_three_ports(self):
        result = apply_market_overrides(FIXTURE["luat"], FIXTURE["phu"])
        md = FIXTURE["mong_doi"]
        assert _strip_comments(result["markets"]) == md["markets"]
        assert _strip_comments(result["market_aliases"]) == md["market_aliases"]
        assert result["camp_market_tokens"] == md["camp_market_tokens"]
        assert {k: t["markets"] for k, t in result["access"]["teams"].items()} == md["teams"]

    def test_does_not_mutate_input_rules(self):
        before = json.dumps(FIXTURE["luat"], sort_keys=True)
        apply_market_overrides(FIXTURE["luat"], FIXTURE["phu"])
        assert json.dumps(FIXTURE["luat"], sort_keys=True) == before

    def test_no_overrides_returns_unchanged(self):
        assert apply_market_overrides(FIXTURE["luat"], None) == FIXTURE["luat"]


class TestReadOverrideFile:
    def test_no_file_yet(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(tmp_path / "khong_co.json"))
        assert load_market_overrides() is None

    def test_corrupt_file_ignored_without_crash(self, tmp_path, monkeypatch, capsys):
        p = tmp_path / "thi_truong.json"
        p.write_text("{hỏng", encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        assert load_market_overrides() is None
        assert "hỏng định dạng" in capsys.readouterr().err


class TestViewFingerprint:
    """Sync tự dựng lại view khi SQL sinh từ luật đổi (sync/core/pg_view.py băm câu SQL đã sinh)."""

    def _fingerprint(self, tmp_path, monkeypatch, overrides):
        p = tmp_path / "thi_truong.json"
        p.write_text(json.dumps(overrides or {}, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        from sync.core.pg_view import render_all
        return render_all()[1]

    def test_rate_divisor_status_or_new_market_changes_fingerprint(self, tmp_path, monkeypatch):
        baseline = self._fingerprint(tmp_path, monkeypatch, None)
        assert self._fingerprint(tmp_path, monkeypatch, {"markets": {"Singapore": {"rate_vnd": 19000}}}) != baseline
        assert self._fingerprint(tmp_path, monkeypatch, {"markets": {"Singapore": {"pos_money_divisor": 1}}}) != baseline
        assert self._fingerprint(tmp_path, monkeypatch, THAILAND) != baseline

    def test_display_name_change_keeps_fingerprint(self, tmp_path, monkeypatch):
        goc = self._fingerprint(tmp_path, monkeypatch, None)
        assert self._fingerprint(tmp_path, monkeypatch, {"markets": {"Singapore": {"display": "Sing"}}}) == goc


class TestNewMarketPropagates:
    def test_sync_fetches_new_shop_orders(self):
        rules = apply_market_overrides(json.loads((ROOT / "config" / "talpha_rules.json").read_text(encoding="utf-8")), THAILAND)
        ds = {s["label"]: s for s in pos_shops_from_markets(rules["markets"], {"TALPHA_POSCAKE_TH_KEY": "k-th"})}
        assert ds["TH"]["shop_id"] == "123456" and ds["TH"]["key"] == "k-th" and ds["TH"]["keo"] is True
        assert {"TW", "SG", "AE", "JP"} <= set(ds)

    def test_view_has_new_market_rate_and_divisor(self, tmp_path, monkeypatch):
        # Chỉ dựng câu SQL (hàm thuần của bộ dựng view) — không kết nối Postgres.
        p = tmp_path / "thi_truong.json"
        p.write_text(json.dumps(THAILAND, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        from sync.core import pg_view as D
        case, known = D.fx_sql()
        assert "WHEN 'TH' THEN 700.0" in case and "'TH'" in known
        assert "WHEN 'TW' THEN 800.0" in case          # nước cũ vẫn nguyên
        assert "WHEN 'TH' THEN 1" in D.money_divisor_sql()

    def test_sheet_reads_overridden_rules(self, tmp_path, monkeypatch):
        p = tmp_path / "thi_truong.json"
        p.write_text(json.dumps(THAILAND, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setenv("TALPHA_THI_TRUONG", str(p))
        monkeypatch.setenv("TALPHA_RULES", str(ROOT / "config" / "talpha_rules.json"))
        spec = importlib.util.spec_from_file_location("talpha_rules_phu", ROOT / "ops" / "talpha_reports" / "talpha_rules.py")
        R = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(R)
        assert R.RATE["Thailand"] == 700 and R.MONEY_DIV["Thailand"] == 1
        assert "Thailand" in R.ALLM and "Thailand" in R.ACTIVE_MARKETS
        assert R.campaign_market("TH/LOC/PHI/042-BLACK/Trang/2808") == ("Thailand", "o_dau")
        assert R.campaign_market("TW/LOC/PHI/042-BLACK/Trang/2808")[0] == "Taiwan"
