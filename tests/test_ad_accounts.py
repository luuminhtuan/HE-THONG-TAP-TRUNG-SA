"""
Danh bạ TKQC tự động + loại TKQC (04/11/2026).

Chạy: DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \\
        TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_ad_accounts.py -q
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

from sync.core.ad_accounts import initial_account_type, meta_budget_offset, write_ad_account_directory  # noqa: E402

RULES = json.loads((ROOT / "config" / "talpha_rules.json").read_text(encoding="utf-8"))


class TestInitialAccountType:
    def test_vnd_gets_default_type(self):
        assert initial_account_type("111", "VND", RULES) == RULES["ad_account_categories"]["default"] == "antalo"

    def test_other_currency_excluded_from_reports(self):
        account_type = initial_account_type("222", "USD", RULES)
        assert account_type == "other" and not RULES["ad_account_categories"]["categories"][account_type]["include_in_report"]

    def test_seed_account_preassigned(self):
        category = initial_account_type("2332183394212686", "VND", RULES)
        assert category == "seed" and not RULES["ad_account_categories"]["categories"][category]["include_in_report"]

    def test_every_preassigned_type_is_declared(self):
        cfg = RULES["ad_account_categories"]
        category = {k for k in cfg["categories"] if not k.startswith("_")}
        preassigned = {v for k, v in cfg["preassigned"].items() if not k.startswith("_")}
        assert preassigned | {cfg["default"], cfg["non_vnd"]} <= category


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


class TestMetaBudgetOffset:
    # Ngân sách Meta theo đơn vị nhỏ nhất của tiền TKQC. Trước 16/11/2026 sync chia 100 cho mọi TK — kho thật
    # lưu ngân sách ngày 1.500 đ cho camp VND đặt 150.000 đ.
    def test_zero_decimal_currencies_divide_by_one(self):
        assert [meta_budget_offset(c, RULES) for c in ("VND", "vnd", "TWD", "JPY")] == [1, 1, 1, 1]

    def test_cent_currencies_divide_by_100(self):
        assert [meta_budget_offset(c, RULES) for c in ("USD", "BDT", "SGD", "AED")] == [100, 100, 100, 100]

    def test_unknown_currency_uses_default(self):
        assert meta_budget_offset(None, RULES) == meta_budget_offset("", RULES) == RULES["meta_currency_offset"]["default"]


def _meta(aid, name, currency="VND", tz="Asia/Ho_Chi_Minh", st=1):
    return {"account_id": aid, "name": name, "currency": currency, "timezone_name": tz, "account_status": st}


class TestAdAccountDirectory:
    def test_new_account_gets_type_existing_keeps_user_choice(self, pg):
        new_accounts = write_ad_account_directory(pg, [_meta("111", "Hồ Lý 11"), _meta("2332183394212686", "XUAN THAI (việt)")], RULES)
        assert sorted(new_accounts) == [("111", "Hồ Lý 11", "antalo"), ("2332183394212686", "XUAN THAI (việt)", "seed")]
        pg.execute("UPDATE ad_accounts SET category = 'other', is_confirmed = true WHERE account_id = '111'")   # người đổi trên trang
        assert write_ad_account_directory(pg, [_meta("111", "Hồ Lý 11 (đổi tên)", st=2)], RULES) == []
        assert pg.execute("SELECT category, name, account_status, is_confirmed FROM ad_accounts WHERE account_id = '111'").fetchone() == (
            "other", "Hồ Lý 11 (đổi tên)", 2, True)

    def test_view_counts_only_report_accounts_type_change_is_immediate(self, pg):
        from sync.core import pg_writer
        from sync.core.pg_view import rebuild_views
        write_ad_account_directory(pg, [_meta("111", "Hồ Lý 11"), _meta("2332183394212686", "XUAN THAI (việt)"),
                         _meta("333", "Canada", currency="USD")], RULES)
        ad_row = lambda aid, currency: {"ad_id": f"ad{aid}", "account_id": aid, "date": "2026-11-03", "spend": currency,
                                  "campaign_name": "TW/LOC/PHI/042/Trang/0311", "sync_time": "t1"}
        pg_writer.write_ads(pg, [ad_row("111", 100.0), ad_row("2332183394212686", 50.0), ad_row("333", 7.0),
                               ad_row("999", 3.0)], "fb_ads_all", "ad_id")
        rebuild_views(pg, force=True)
        total = lambda table: pg.execute(f"SELECT COALESCE(SUM(spend), 0) FROM {table}").fetchone()[0]
        assert total("fb_ads_all") == 160.0                 # thống kê đủ mọi TK
        assert total("fb_ads_data") == 103.0                   # Hồ Lý (antalo) + TK chưa có trong danh bạ (mặc định)
        assert total("vw_fb_ads_std") == 103.0
        pg.execute("UPDATE ad_accounts SET category = 'seed' WHERE account_id = '111'")
        assert total("fb_ads_data") == 3.0                     # không cần dựng lại view


class TestMultipleTokens:
    def test_tokens_in_priority_order_skip_blank(self):
        from sync.core.ad_accounts import meta_tokens
        env = {"TALPHA_META_ACCESS_TOKEN_3": "c", "TALPHA_META_ACCESS_TOKEN": "a", "TALPHA_META_ACCESS_TOKEN_2": " "}
        assert meta_tokens(env) == [("TALPHA_META_ACCESS_TOKEN", "a"), ("TALPHA_META_ACCESS_TOKEN_3", "c")]

    def test_account_belongs_to_first_token_that_sees_it(self, pg, monkeypatch):
        from sync.core import ad_accounts as T
        accounts_by_token = {"moi": [_meta("1", "Hồ Lý 11"), _meta("2", "Dùng chung")],
                "cu": [_meta("2", "Dùng chung"), _meta("3", "XT ANTALO 03", st=2)]}
        monkeypatch.setattr(T, "list_token_ad_accounts", lambda tok: accounts_by_token[tok])
        ds = T.ad_accounts_to_fetch(pg, [("TALPHA_META_ACCESS_TOKEN", "moi"), ("TALPHA_META_ACCESS_TOKEN_2", "cu")], RULES)
        assert {d["id"]: d["token"] for d in ds} == {"act_1": "moi", "act_2": "moi", "act_3": "cu"}
        assert {d["currency"] for d in ds} == {"VND"}         # campaign_sync chia ngân sách theo tiền này
        assert dict(pg.execute("SELECT account_id, token_env_var FROM ad_accounts").fetchall()) == {
            "1": "TALPHA_META_ACCESS_TOKEN", "2": "TALPHA_META_ACCESS_TOKEN", "3": "TALPHA_META_ACCESS_TOKEN_2"}

    def test_all_tokens_dead_fall_back_to_directory_with_currency(self, pg, monkeypatch):
        from sync.core import ad_accounts as T
        write_ad_account_directory(pg, [_meta("9", "TK USD", currency="USD")], RULES)

        def dead(tok):
            raise RuntimeError("Session has expired")
        monkeypatch.setattr(T, "list_token_ad_accounts", dead)
        ds = T.ad_accounts_to_fetch(pg, [("TALPHA_META_ACCESS_TOKEN", "chet")], RULES)
        assert [(d["id"], d["currency"], d["token"]) for d in ds] == [("act_9", "USD", "chet")]

    def test_one_dead_token_still_fetches_others(self, pg, monkeypatch):
        from sync.core import ad_accounts as T

        def fake_fetch(tok):
            if tok == "chet":
                raise RuntimeError("Session has expired")
            return [_meta("3", "XT ANTALO 03")]
        monkeypatch.setattr(T, "list_token_ad_accounts", fake_fetch)
        ds = T.ad_accounts_to_fetch(pg, [("TALPHA_META_ACCESS_TOKEN", "chet"), ("TALPHA_META_ACCESS_TOKEN_2", "cu")], RULES)
        assert [(d["id"], d["token_env_var"]) for d in ds] == [("act_3", "TALPHA_META_ACCESS_TOKEN_2")]
