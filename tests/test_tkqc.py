"""
Danh bạ TKQC tự động + loại TKQC (04/11/2026).

Chạy: DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \\
        TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_tkqc.py -q
(phần cần Postgres tự bỏ qua khi không nối được; dựng schema tạm rồi xoá — không đụng bảng thật)

Canh những chỗ làm sai số nếu trượt:
  • TKQC bán hạt giống trong nước (camp không ghi nước) lọt vào báo cáo → tiền dồn về Đài;
  • TKQC tính bằng USD vào báo cáo như VND → sai 25.000 lần;
  • vòng sync ghi đè loại người đã chọn trên trang;
  • đổi loại mà view vẫn tính TK đó.
"""
import json
import os
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sync.core.tkqc import write_ad_account_directory, initial_account_type  # noqa: E402

RULES = json.loads((ROOT / "config" / "talpha_rules.json").read_text(encoding="utf-8"))


class TestInitialAccountType:
    def test_vnd_gets_default_type(self):
        assert initial_account_type("111", "VND", RULES) == RULES["tkqc_loai"]["mac_dinh"] == "antalo"

    def test_other_currency_excluded_from_reports(self):
        account_type = initial_account_type("222", "USD", RULES)
        assert account_type == "khac" and not RULES["tkqc_loai"]["loai"][account_type]["vao_bao_cao"]

    def test_seed_account_preassigned(self):
        loai = initial_account_type("2332183394212686", "VND", RULES)
        assert loai == "hat_giong" and not RULES["tkqc_loai"]["loai"][loai]["vao_bao_cao"]

    def test_every_preassigned_type_is_declared(self):
        cfg = RULES["tkqc_loai"]
        loai = {k for k in cfg["loai"] if not k.startswith("_")}
        preassigned = {v for k, v in cfg["gan_san"].items() if not k.startswith("_")}
        assert preassigned | {cfg["mac_dinh"], cfg["loai_tien_khac"]} <= loai


@pytest.fixture
def pg():
    url = os.environ.get("TALPHA_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("chưa đặt DATABASE_URL — bỏ qua phần chạy trên Postgres thật")
    psycopg = pytest.importorskip("psycopg")
    from sync.core.pg import run_migrations, get_connection
    try:
        conn = get_connection(url)
    except psycopg.OperationalError as e:
        pytest.skip(f"không nối được Postgres: {e}")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    run_migrations(conn)
    try:
        yield conn
    finally:
        conn.execute(f"DROP SCHEMA {schema} CASCADE")   # schema tạm của lần chạy này
        conn.close()


def _meta(aid, name, currency="VND", tz="Asia/Ho_Chi_Minh", st=1):
    return {"account_id": aid, "name": name, "currency": currency, "timezone_name": tz, "account_status": st}


class TestAdAccountDirectory:
    def test_new_account_gets_type_existing_keeps_user_choice(self, pg):
        new_accounts = write_ad_account_directory(pg, [_meta("111", "Hồ Lý 11"), _meta("2332183394212686", "XUAN THAI (việt)")], RULES)
        assert sorted(new_accounts) == [("111", "Hồ Lý 11", "antalo"), ("2332183394212686", "XUAN THAI (việt)", "hat_giong")]
        pg.execute("UPDATE tkqc SET loai = 'khac', da_xac_nhan = true WHERE account_id = '111'")   # người đổi trên trang
        assert write_ad_account_directory(pg, [_meta("111", "Hồ Lý 11 (đổi tên)", st=2)], RULES) == []
        assert pg.execute("SELECT loai, ten, trang_thai, da_xac_nhan FROM tkqc WHERE account_id = '111'").fetchone() == (
            "khac", "Hồ Lý 11 (đổi tên)", 2, True)

    def test_view_counts_only_report_accounts_type_change_is_immediate(self, pg):
        from sync.core import pg_writer
        from sync.core.pg_view import rebuild_views
        write_ad_account_directory(pg, [_meta("111", "Hồ Lý 11"), _meta("2332183394212686", "XUAN THAI (việt)"),
                         _meta("333", "Canada", currency="USD")], RULES)
        ad_row = lambda aid, currency: {"ad_id": f"ad{aid}", "account_id": aid, "date": "2026-11-03", "spend": currency,
                                  "campaign_name": "TW/LOC/PHI/042/Trang/0311", "sync_time": "t1"}
        pg_writer.write_ads(pg, [ad_row("111", 100.0), ad_row("2332183394212686", 50.0), ad_row("333", 7.0),
                               ad_row("999", 3.0)], "fb_ads_tat_ca", "ad_id")
        rebuild_views(pg, force=True)
        total = lambda table: pg.execute(f"SELECT COALESCE(SUM(spend), 0) FROM {table}").fetchone()[0]
        assert total("fb_ads_tat_ca") == 160.0                 # thống kê đủ mọi TK
        assert total("fb_ads_data") == 103.0                   # Hồ Lý (antalo) + TK chưa có trong danh bạ (mặc định)
        assert total("vw_fb_ads_std") == 103.0
        pg.execute("UPDATE tkqc SET loai = 'hat_giong' WHERE account_id = '111'")
        assert total("fb_ads_data") == 3.0                     # không cần dựng lại view


class TestMultipleTokens:
    def test_tokens_in_priority_order_skip_blank(self):
        from sync.core.tkqc import meta_tokens
        env = {"TALPHA_META_ACCESS_TOKEN_3": "c", "TALPHA_META_ACCESS_TOKEN": "a", "TALPHA_META_ACCESS_TOKEN_2": " "}
        assert meta_tokens(env) == [("TALPHA_META_ACCESS_TOKEN", "a"), ("TALPHA_META_ACCESS_TOKEN_3", "c")]

    def test_account_belongs_to_first_token_that_sees_it(self, pg, monkeypatch):
        from sync.core import tkqc as T
        accounts_by_token = {"moi": [_meta("1", "Hồ Lý 11"), _meta("2", "Dùng chung")],
                "cu": [_meta("2", "Dùng chung"), _meta("3", "XT ANTALO 03", st=2)]}
        monkeypatch.setattr(T, "list_token_ad_accounts", lambda tok: accounts_by_token[tok])
        ds = T.ad_accounts_to_fetch(pg, [("TALPHA_META_ACCESS_TOKEN", "moi"), ("TALPHA_META_ACCESS_TOKEN_2", "cu")], RULES)
        assert {d["id"]: d["token"] for d in ds} == {"act_1": "moi", "act_2": "moi", "act_3": "cu"}
        assert dict(pg.execute("SELECT account_id, bien_token FROM tkqc").fetchall()) == {
            "1": "TALPHA_META_ACCESS_TOKEN", "2": "TALPHA_META_ACCESS_TOKEN", "3": "TALPHA_META_ACCESS_TOKEN_2"}

    def test_one_dead_token_still_fetches_others(self, pg, monkeypatch):
        from sync.core import tkqc as T

        def fake_fetch(tok):
            if tok == "chet":
                raise RuntimeError("Session has expired")
            return [_meta("3", "XT ANTALO 03")]
        monkeypatch.setattr(T, "list_token_ad_accounts", fake_fetch)
        ds = T.ad_accounts_to_fetch(pg, [("TALPHA_META_ACCESS_TOKEN", "chet"), ("TALPHA_META_ACCESS_TOKEN_2", "cu")], RULES)
        assert [(d["id"], d["bien"]) for d in ds] == [("act_3", "TALPHA_META_ACCESS_TOKEN_2")]
