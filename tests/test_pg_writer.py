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
from sync.core.pg_writer import DA_XOA_TREN_POS  # noqa: E402

MIGRATION = ROOT / "db" / "migrations" / "0001_bang_tho.sql"
TAT_CA_MIGRATION = sorted(p.name for p in (ROOT / "db" / "migrations").glob("*.sql"))


def _schema_migration():
    """{bảng: [(cột, kiểu)]} của các CREATE TABLE có khai cột trong file migration 0001."""
    sql = MIGRATION.read_text(encoding="utf-8")
    out = {}
    for ten, than in re.findall(r"CREATE TABLE (\w+) \(\n(.*?)\n\);", sql, re.S):
        out[ten] = re.findall(r"^\s+(\w+)\s+(text|double precision|bigint|date|timestamptz),?$", than, re.M)
    return out


class TestCauTrucBang:
    def test_bang_raw_chep_dung_bang_sach(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        for bang in ("sale_order", "order_items", "fb_ads_data", "fb_adset_data"):
            assert f"CREATE TABLE {bang}_raw (LIKE {bang});" in sql

    def test_cot_sync_ghi_deu_co_trong_bang(self):
        # Sync ghi dòng có cột bảng chưa có thì dừng giữa chừng (pg_writer.them_dong) — soát trước.
        bang = _schema_migration()
        cot = lambda b: {c for c, _ in bang[b]}
        assert {"page_name", "seller_name", "inserted_at", "updated_at", "sync_time", "cod"} <= cot("sale_order")
        assert {"spend", "date", "messaging_conversations_started", "account_id"} <= cot("fb_ads_data")
        assert dict(bang["fb_ads_data"])["date"] == "date" and dict(bang["sale_order"])["inserted_at"] == "text"

    def test_ad_dictionary_du_cot(self):
        assert [c for c, _ in _schema_migration()["ad_dictionary"]] == [
            "ad_id", "account_id", "account_name", "campaign_id", "campaign_name", "ad_name", "status", "sync_time"]


class TestCauSql:
    def test_dung_lai_don_dung_luat_bigquery(self):
        sql = pg_writer.sql_dung_lai_don("sale_order", ["1022091930", "715135541"])
        assert "DISTINCT ON (shop_id, id)" in sql
        assert "updated_at DESC NULLS LAST, sync_time DESC NULLS LAST" in sql
        assert "WHERE shop_id IN ('1022091930', '715135541')" in sql
        assert DA_XOA_TREN_POS in sql

    def test_ten_bang_la_bi_chan(self):
        with pytest.raises(ValueError):
            pg_writer.sql_dung_lai_don("sale_order; DROP TABLE x")
        with pytest.raises(ValueError):
            pg_writer._ten("Sale_Order")

    def test_gia_tri_nhu_bigquery_nhan_json(self):
        assert pg_writer._gia_tri(5, "text") == "5"
        assert pg_writer._gia_tri({"a": 1}, "text") == '{"a": 1}'
        assert pg_writer._gia_tri("", "date") is None
        assert pg_writer._gia_tri("", "double precision") is None
        assert pg_writer._gia_tri(3.0, "bigint") == 3
        assert pg_writer._gia_tri("", "text") == ""


# ─── Phần cần Postgres thật ────────────────────────────────────────────────────────────

def _url():
    return os.environ.get("TALPHA_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")


@pytest.fixture
def pg():
    if not _url():
        pytest.skip("chưa đặt DATABASE_URL — bỏ qua phần chạy trên Postgres thật")
    psycopg = pytest.importorskip("psycopg")
    from sync.core.pg import chay_migrations, ket_noi
    try:
        conn = ket_noi(_url())
    except psycopg.OperationalError as e:
        pytest.skip(f"không nối được Postgres: {e}")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    assert chay_migrations(conn) == TAT_CA_MIGRATION
    try:
        yield conn
    finally:
        conn.execute(f"DROP SCHEMA {schema} CASCADE")   # schema tạm của lần chạy này
        conn.close()


SHOP_TW, SHOP_SG = "1022091930", "715135541"


def _don(id_, shop=SHOP_TW, updated="2026-11-01T01:00:00", status="new", ins="2026-11-01T00:00:00", sync="t1", **them):
    d = {"id": str(id_), "shop_id": shop, "shop_label": "TW", "status_name": status, "cod": 1000.0,
         "inserted_at": ins, "updated_at": updated, "sync_time": sync, "page_name": "Page A", "seller_name": "Lan"}
    d.update(them)
    return d


def _item(order_id, item_id, shop=SHOP_TW, sync="t1", qty=1):
    return {"item_id": str(item_id), "order_id": str(order_id), "shop_id": shop, "quantity": qty,
            "retail_price": 500.0, "sync_time": sync}


def _dem(conn, bang):
    return conn.execute(f"SELECT COUNT(*) FROM {bang}").fetchone()[0]


class TestMigration:
    def test_chay_lai_khong_lam_gi(self, pg):
        from sync.core.pg import chay_migrations
        assert chay_migrations(pg) == []


class TestGhiDon:
    def test_chi_ghi_them_don_moi_hoac_doi(self, pg):
        assert pg_writer.ghi_don(pg, [_don(1), _don(2)], [_item(1, "a"), _item(2, "b")]) == (2, 2)
        doi = _don(2, updated="2026-11-01T05:00:00", status="shipped", sync="t2")
        pg_writer.ghi_don(pg, [_don(1, sync="t2"), doi], [_item(1, "a", sync="t2"), _item(2, "b", sync="t2")])
        assert _dem(pg, "sale_order_raw") == 3          # đơn 1 không đổi → không ghi thêm
        assert pg.execute("SELECT status_name FROM sale_order WHERE id = '2'").fetchone()[0] == "shipped"
        assert _dem(pg, "sale_order") == 2

    def test_cung_ma_don_khac_shop_la_hai_don(self, pg):
        assert pg_writer.ghi_don(pg, [_don(18, shop=SHOP_TW), _don(18, shop=SHOP_SG)], [])[0] == 2

    def test_updated_at_trong_khong_thang_ban_co_ngay(self, pg):
        pg_writer.ghi_don(pg, [_don(1, updated="2026-11-01T05:00:00", status="shipped")], [])
        pg.execute("INSERT INTO sale_order_raw (id, shop_id, status_name, updated_at, sync_time) "
                   "VALUES ('1', %s, 'hong', NULL, 't9')", (SHOP_TW,))
        pg_writer.ghi_don(pg, [], [])
        assert pg.execute("SELECT status_name FROM sale_order WHERE id = '1'").fetchone()[0] == "shipped"

    def test_item_lay_tron_bo_lan_sync_moi_nhat(self, pg):
        pg_writer.ghi_don(pg, [_don(1)], [_item(1, "a"), _item(1, "b")])
        pg_writer.ghi_don(pg, [_don(1, updated="2026-11-01T09:00:00", sync="t2")], [_item(1, "a", sync="t2")])
        assert [r[0] for r in pg.execute("SELECT item_id FROM order_items")] == ["a"]

    def test_don_bi_xoa_tren_pos_bo_khoi_bang_giu_trong_raw(self, pg):
        pg_writer.ghi_don(pg, [_don(1), _don(2)], [])
        pg_writer.ghi_don(pg, [_don(1, sync="t2")], [],
                          da_thay={SHOP_TW: ("2026-10-01T00:00:00", {"1"})})
        assert [r[0] for r in pg.execute("SELECT id FROM sale_order")] == ["1"]
        assert pg.execute("SELECT COUNT(*) FROM sale_order_raw WHERE id = '2' AND status_name = %s",
                          (DA_XOA_TREN_POS,)).fetchone()[0] == 1
        pg_writer.ghi_don(pg, [_don(2, updated="2026-11-02T00:00:00", sync="t3")], [])   # hiện lại trên POS
        assert _dem(pg, "sale_order") == 2

    def test_pos_tra_0_don_thi_khong_xoa_gi(self, pg):
        pg_writer.ghi_don(pg, [_don(1), _don(2)], [])
        pg_writer.ghi_don(pg, [], [], da_thay={SHOP_TW: ("2026-10-01T00:00:00", set())})
        assert _dem(pg, "sale_order") == 2

    def test_bang_sach_chi_gom_shop_dang_khai(self, pg):
        n, _ = pg_writer.ghi_don(pg, [_don(1, shop="408074608"), _don(1)], [], shop_ids=[SHOP_TW, SHOP_SG])
        assert n == 1 and _dem(pg, "sale_order_raw") == 2   # shop cũ vẫn nằm trong raw

    def test_dien_nguoc_cot_moi_khi_bang_con_trong(self, pg):
        pg_writer.ghi_don(pg, [_don(1, page_name=None)], [])
        pg_writer.ghi_don(pg, [_don(1, sync="t2")], [])     # cùng updated_at nhưng POS đã có tên page
        assert pg.execute("SELECT page_name FROM sale_order").fetchone()[0] == "Page A"

    def test_loi_giua_chung_khong_mat_gi(self, pg):
        pg_writer.ghi_don(pg, [_don(1)], [_item(1, "a")])
        with pytest.raises(Exception):
            pg_writer.ghi_don(pg, [_don(2, sync="t2")], [_item(2, "b", sync="t2", qty="hai")])
        assert _dem(pg, "sale_order_raw") == 1 and _dem(pg, "sale_order") == 1

    def test_cot_la_bao_loi_ro(self, pg):
        with pytest.raises(RuntimeError, match="thêm file migration"):
            pg_writer.ghi_don(pg, [_don(1, cot_chua_co="x")], [])


class TestGhiAds:
    @staticmethod
    def _ad(ad, ngay, spend, sync):
        return {"ad_id": ad, "account_id": "123", "date": ngay, "spend": spend, "impressions": 10, "sync_time": sync}

    def test_ban_moi_nhat_thang_ngay_ngoai_cua_so_giu_nguyen(self, pg):
        pg_writer.ghi_ads(pg, [self._ad("a", "2026-10-31", 100.0, "t1"), self._ad("a", "2026-11-01", 50.0, "t1")],
                          "fb_ads_data", "ad_id")
        n = pg_writer.ghi_ads(pg, [self._ad("a", "2026-11-01", 80.0, "t2")], "fb_ads_data", "ad_id")
        assert n == 2
        assert dict((str(d), s) for d, s in pg.execute("SELECT date, spend FROM fb_ads_data")) == {
            "2026-10-31": 100.0, "2026-11-01": 80.0}

    def test_id_col_la_bi_chan(self, pg):
        with pytest.raises(ValueError):
            pg_writer.ghi_ads(pg, [], "fb_ads_data", "date; DROP")


class TestThayCaBang:
    def test_thay_va_0_dong_thi_giu_bang_cu(self, pg):
        pg_writer.thay_ca_bang(pg, "fb_campaign_data", [{"campaign_id": "1"}, {"campaign_id": "2"}])
        pg_writer.thay_ca_bang(pg, "fb_campaign_data", [{"campaign_id": "3"}])
        assert [r[0] for r in pg.execute("SELECT campaign_id FROM fb_campaign_data")] == ["3"]
        pg_writer.thay_ca_bang(pg, "fb_campaign_data", [])
        assert _dem(pg, "fb_campaign_data") == 1

    def test_partner_orders_ngay_trong_va_gio_utc(self, pg):
        pg_writer.thay_ca_bang(pg, "partner_orders", [{"order_no": "A1", "order_date": "", "ship_date": "2026-11-02",
                                                     "quantity": 2, "synced_at": "2026-11-04T03:00:00"}])
        d, s, t = pg.execute("SELECT order_date, ship_date::text, synced_at::text FROM partner_orders").fetchone()
        assert d is None and s == "2026-11-02" and t.startswith("2026-11-04 03:00:00")


class TestAdDictionary:
    def test_id_tren_don_chua_co_o_dau_ca(self, pg):
        pg_writer.ghi_don(pg, [_don(1, ad_id="111"), _don(2, p_utm_term="120200000000001", ad_id="222"),
                               _don(3, ad_id="333")], [])
        pg_writer.ghi_ads(pg, [{"ad_id": "111", "account_id": "1", "date": "2026-11-01", "sync_time": "t"}],
                          "fb_ads_data", "ad_id")
        pg_writer.them_dong(pg, "ad_dictionary", [{"ad_id": "333", "status": "ok"}])
        assert pg_writer.ad_id_can_tra(pg) == ["120200000000001"]
