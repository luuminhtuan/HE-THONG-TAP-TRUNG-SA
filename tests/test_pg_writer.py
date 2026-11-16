"""
Kho Postgres (04/11/2026) — ghi số cùng luật với BigQuery.

Chạy (phần không cần Postgres):
  TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_pg_writer.py -q
Phần cần Postgres thật tự bỏ qua khi không nối được; chạy đủ:
  docker compose up -d db && DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \\
    python3 -m pytest tests/test_pg_writer.py -q
  (hoặc trong container: docker compose run --rm --entrypoint python migrate -m pytest tests/test_pg_writer.py -q)
Mỗi lần chạy dựng một schema riêng rồi xoá — không đụng bảng thật của Postgres đó.

Canh những chỗ làm sai số nếu trượt:
  • bảng Postgres lệch cột / kiểu với schema BigQuery của sync → vòng sync chết, hoặc dashboard đọc
    hai kho ra hai số;
  • dựng lại bảng sạch khác luật BigQuery (bản mới nhất, bia mộ, lọc shop, NULL xếp cuối);
  • kéo hụt / lỗi giữa chừng xoá mất số đã có.
"""
import os
import re
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sync.core import pg_writer  # noqa: E402
from sync.core.pg_writer import DELETED_ON_POS  # noqa: E402

MIGRATION = ROOT / "db" / "migrations" / "0001_bang_tho.sql"
ALL_MIGRATIONS = sorted(p.name for p in (ROOT / "db" / "migrations").glob("*.sql"))


def _schema_migration():
    """{bảng: [(cột, kiểu)]} của các CREATE TABLE có khai cột trong file migration 0001."""
    sql = MIGRATION.read_text(encoding="utf-8")
    out = {}
    for name, body in re.findall(r"CREATE TABLE (\w+) \(\n(.*?)\n\);", sql, re.S):
        out[name] = re.findall(r"^\s+(\w+)\s+(text|double precision|bigint|date|timestamptz),?$", body, re.M)
    return out


class TestTableStructure:
    def test_raw_table_mirrors_clean_table(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        for table in ("sale_order", "order_items", "fb_ads_data", "fb_adset_data"):
            assert f"CREATE TABLE {table}_raw (LIKE {table});" in sql

    def test_synced_columns_exist_in_tables(self):
        # Sync ghi dòng có cột bảng chưa có thì dừng giữa chừng (pg_writer.them_dong) — soát trước.
        table = _schema_migration()
        columns = lambda b: {c for c, _ in table[b]}
        assert {"page_name", "seller_name", "inserted_at", "updated_at", "sync_time", "cod"} <= columns("sale_order")
        assert {"spend", "date", "messaging_conversations_started", "account_id"} <= columns("fb_ads_data")
        assert dict(table["fb_ads_data"])["date"] == "date" and dict(table["sale_order"])["inserted_at"] == "text"

    def test_ad_dictionary_has_all_columns(self):
        assert [c for c, _ in _schema_migration()["ad_dictionary"]] == [
            "ad_id", "account_id", "account_name", "campaign_id", "campaign_name", "ad_name", "status", "sync_time"]


class TestSqlBuilders:
    def test_rebuild_orders_matches_bigquery_rule(self):
        sql = pg_writer.sql_rebuild_orders("sale_order", ["1022091930", "715135541"])
        assert "DISTINCT ON (shop_id, id)" in sql
        assert "updated_at DESC NULLS LAST, sync_time DESC NULLS LAST" in sql
        assert "WHERE shop_id IN ('1022091930', '715135541')" in sql
        assert DELETED_ON_POS in sql

    def test_invalid_table_name_rejected(self):
        with pytest.raises(ValueError):
            pg_writer.sql_rebuild_orders("sale_order; DROP TABLE x")
        with pytest.raises(ValueError):
            pg_writer._safe_ident("Sale_Order")

    def test_values_like_bigquery_accept_json(self):
        assert pg_writer._to_db_value(5, "text") == "5"
        assert pg_writer._to_db_value({"a": 1}, "text") == '{"a": 1}'
        assert pg_writer._to_db_value("", "date") is None
        assert pg_writer._to_db_value("", "double precision") is None
        assert pg_writer._to_db_value(3.0, "bigint") == 3
        assert pg_writer._to_db_value("", "text") == ""


# ─── Phần cần Postgres thật ────────────────────────────────────────────────────────────

def _url():
    return os.environ.get("TALPHA_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")


@pytest.fixture
def pg():
    if not _url():
        pytest.skip("chưa đặt DATABASE_URL — bỏ qua phần chạy trên Postgres thật")
    psycopg = pytest.importorskip("psycopg")
    from sync.core.pg import run_migrations, get_connection
    try:
        conn = get_connection(_url())
    except psycopg.OperationalError as e:
        pytest.skip(f"không nối được Postgres: {e}")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    assert run_migrations(conn) == ALL_MIGRATIONS
    try:
        yield conn
    finally:
        conn.execute(f"DROP SCHEMA {schema} CASCADE")   # schema tạm của lần chạy này
        conn.close()


SHOP_TW, SHOP_SG = "1022091930", "715135541"


def _order(id_, shop=SHOP_TW, updated="2026-11-01T01:00:00", status="new", ins="2026-11-01T00:00:00", sync="t1", **extra):
    d = {"id": str(id_), "shop_id": shop, "shop_label": "TW", "status_name": status, "cod": 1000.0,
         "inserted_at": ins, "updated_at": updated, "sync_time": sync, "page_name": "Page A", "seller_name": "Lan"}
    d.update(extra)
    return d


def _item(order_id, item_id, shop=SHOP_TW, sync="t1", qty=1):
    return {"item_id": str(item_id), "order_id": str(order_id), "shop_id": shop, "quantity": qty,
            "retail_price": 500.0, "sync_time": sync}


def _count(conn, table):
    return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


class TestMigration:
    def test_rerun_is_noop(self, pg):
        from sync.core.pg import run_migrations
        assert run_migrations(pg) == []


class TestWriteOrders:
    def test_appends_only_new_or_changed_orders(self, pg):
        assert pg_writer.write_orders(pg, [_order(1), _order(2)], [_item(1, "a"), _item(2, "b")]) == (2, 2)
        changed = _order(2, updated="2026-11-01T05:00:00", status="shipped", sync="t2")
        pg_writer.write_orders(pg, [_order(1, sync="t2"), changed], [_item(1, "a", sync="t2"), _item(2, "b", sync="t2")])
        assert _count(pg, "sale_order_raw") == 3          # đơn 1 không đổi → không ghi thêm
        assert pg.execute("SELECT status_name FROM sale_order WHERE id = '2'").fetchone()[0] == "shipped"
        assert _count(pg, "sale_order") == 2

    def test_same_order_id_different_shops_are_two_orders(self, pg):
        assert pg_writer.write_orders(pg, [_order(18, shop=SHOP_TW), _order(18, shop=SHOP_SG)], [])[0] == 2

    def test_null_updated_at_does_not_beat_dated_version(self, pg):
        pg_writer.write_orders(pg, [_order(1, updated="2026-11-01T05:00:00", status="shipped")], [])
        pg.execute("INSERT INTO sale_order_raw (id, shop_id, status_name, updated_at, sync_time) "
                   "VALUES ('1', %s, 'hong', NULL, 't9')", (SHOP_TW,))
        pg_writer.write_orders(pg, [], [])
        assert pg.execute("SELECT status_name FROM sale_order WHERE id = '1'").fetchone()[0] == "shipped"

    def test_items_taken_whole_from_latest_sync(self, pg):
        pg_writer.write_orders(pg, [_order(1)], [_item(1, "a"), _item(1, "b")])
        pg_writer.write_orders(pg, [_order(1, updated="2026-11-01T09:00:00", sync="t2")], [_item(1, "a", sync="t2")])
        assert [r[0] for r in pg.execute("SELECT item_id FROM order_items")] == ["a"]

    def test_order_deleted_on_pos_dropped_from_table_kept_in_raw(self, pg):
        pg_writer.write_orders(pg, [_order(1), _order(2)], [])
        pg_writer.write_orders(pg, [_order(1, sync="t2")], [],
                          replaced={SHOP_TW: ("2026-10-01T00:00:00", {"1"})})
        assert [r[0] for r in pg.execute("SELECT id FROM sale_order")] == ["1"]
        assert pg.execute("SELECT COUNT(*) FROM sale_order_raw WHERE id = '2' AND status_name = %s",
                          (DELETED_ON_POS,)).fetchone()[0] == 1
        pg_writer.write_orders(pg, [_order(2, updated="2026-11-02T00:00:00", sync="t3")], [])   # hiện lại trên POS
        assert _count(pg, "sale_order") == 2

    def test_pos_returns_zero_orders_deletes_nothing(self, pg):
        pg_writer.write_orders(pg, [_order(1), _order(2)], [])
        pg_writer.write_orders(pg, [], [], replaced={SHOP_TW: ("2026-10-01T00:00:00", set())})
        assert _count(pg, "sale_order") == 2

    def test_clean_table_only_configured_shops(self, pg):
        n, _ = pg_writer.write_orders(pg, [_order(1, shop="408074608"), _order(1)], [], shop_ids=[SHOP_TW, SHOP_SG])
        assert n == 1 and _count(pg, "sale_order_raw") == 2   # shop cũ vẫn nằm trong raw

    def test_backfill_new_column_while_table_blank(self, pg):
        pg_writer.write_orders(pg, [_order(1, page_name=None)], [])
        pg_writer.write_orders(pg, [_order(1, sync="t2")], [])     # cùng updated_at nhưng POS đã có tên page
        assert pg.execute("SELECT page_name FROM sale_order").fetchone()[0] == "Page A"

    def test_midway_error_loses_nothing(self, pg):
        pg_writer.write_orders(pg, [_order(1)], [_item(1, "a")])
        with pytest.raises(Exception):
            pg_writer.write_orders(pg, [_order(2, sync="t2")], [_item(2, "b", sync="t2", qty="hai")])
        assert _count(pg, "sale_order_raw") == 1 and _count(pg, "sale_order") == 1

    def test_unknown_column_raises_clear_error(self, pg):
        with pytest.raises(RuntimeError, match="thêm file migration"):
            pg_writer.write_orders(pg, [_order(1, cot_chua_co="x")], [])


class TestWriteAds:
    @staticmethod
    def _ad(ad, date, spend, sync):
        return {"ad_id": ad, "account_id": "123", "date": date, "spend": spend, "impressions": 10, "sync_time": sync}

    def test_latest_version_wins_days_outside_window_kept(self, pg):
        pg_writer.write_ads(pg, [self._ad("a", "2026-10-31", 100.0, "t1"), self._ad("a", "2026-11-01", 50.0, "t1")],
                          "fb_ads_tat_ca", "ad_id")
        n = pg_writer.write_ads(pg, [self._ad("a", "2026-11-01", 80.0, "t2")], "fb_ads_tat_ca", "ad_id")
        assert n == 2
        assert dict((str(d), s) for d, s in pg.execute("SELECT date, spend FROM fb_ads_tat_ca")) == {
            "2026-10-31": 100.0, "2026-11-01": 80.0}

    def test_invalid_id_col_rejected(self, pg):
        with pytest.raises(ValueError):
            pg_writer.write_ads(pg, [], "fb_ads_tat_ca", "date; DROP")


class TestReplaceTable:
    def test_replace_and_zero_rows_keeps_old_table(self, pg):
        pg_writer.replace_table(pg, "fb_campaign_tat_ca", [{"campaign_id": "1"}, {"campaign_id": "2"}])
        pg_writer.replace_table(pg, "fb_campaign_tat_ca", [{"campaign_id": "3"}])
        assert [r[0] for r in pg.execute("SELECT campaign_id FROM fb_campaign_tat_ca")] == ["3"]
        pg_writer.replace_table(pg, "fb_campaign_tat_ca", [])
        assert _count(pg, "fb_campaign_tat_ca") == 1

    def test_partner_orders_blank_date_and_utc_time(self, pg):
        pg_writer.replace_table(pg, "partner_orders", [{"order_no": "A1", "order_date": "", "ship_date": "2026-11-02",
                                                     "quantity": 2, "synced_at": "2026-11-04T03:00:00"}])
        d, s, t = pg.execute("SELECT order_date, ship_date::text, synced_at::text FROM partner_orders").fetchone()
        assert d is None and s == "2026-11-02" and t.startswith("2026-11-04 03:00:00")


class TestAdDictionary:
    def test_ids_on_orders_missing_everywhere(self, pg):
        pg_writer.write_orders(pg, [_order(1, ad_id="111"), _order(2, p_utm_term="120200000000001", ad_id="222"),
                               _order(3, ad_id="333")], [])
        pg_writer.write_ads(pg, [{"ad_id": "111", "account_id": "1", "date": "2026-11-01", "sync_time": "t"}],
                          "fb_ads_tat_ca", "ad_id")
        pg_writer.insert_rows(pg, "ad_dictionary", [{"ad_id": "333", "status": "ok"}])
        assert pg_writer.ad_ids_to_lookup(pg) == ["120200000000001"]
