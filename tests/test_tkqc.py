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

from sync.core.tkqc import ghi_danh_ba, loai_lan_dau  # noqa: E402

LUAT = json.loads((ROOT / "config" / "talpha_rules.json").read_text(encoding="utf-8"))


class TestLoaiLanDau:
    def test_vnd_vao_loai_mac_dinh(self):
        assert loai_lan_dau("111", "VND", LUAT) == LUAT["tkqc_loai"]["mac_dinh"] == "antalo"

    def test_tien_khac_khong_vao_bao_cao(self):
        loai = loai_lan_dau("222", "USD", LUAT)
        assert loai == "khac" and not LUAT["tkqc_loai"]["loai"][loai]["vao_bao_cao"]

    def test_tk_hat_giong_gan_san(self):
        loai = loai_lan_dau("2332183394212686", "VND", LUAT)
        assert loai == "hat_giong" and not LUAT["tkqc_loai"]["loai"][loai]["vao_bao_cao"]

    def test_moi_loai_gan_san_deu_co_khai(self):
        cfg = LUAT["tkqc_loai"]
        loai = {k for k in cfg["loai"] if not k.startswith("_")}
        gan = {v for k, v in cfg["gan_san"].items() if not k.startswith("_")}
        assert gan | {cfg["mac_dinh"], cfg["loai_tien_khac"]} <= loai


@pytest.fixture
def pg():
    url = os.environ.get("TALPHA_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("chưa đặt DATABASE_URL — bỏ qua phần chạy trên Postgres thật")
    psycopg = pytest.importorskip("psycopg")
    from sync.core.pg import chay_migrations, ket_noi
    try:
        conn = ket_noi(url)
    except psycopg.OperationalError as e:
        pytest.skip(f"không nối được Postgres: {e}")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    chay_migrations(conn)
    try:
        yield conn
    finally:
        conn.execute(f"DROP SCHEMA {schema} CASCADE")   # schema tạm của lần chạy này
        conn.close()


def _meta(aid, ten, tien="VND", tz="Asia/Ho_Chi_Minh", st=1):
    return {"account_id": aid, "name": ten, "currency": tien, "timezone_name": tz, "account_status": st}


class TestDanhBa:
    def test_tk_moi_nhan_loai_tk_cu_giu_loai_nguoi_chon(self, pg):
        moi = ghi_danh_ba(pg, [_meta("111", "Hồ Lý 11"), _meta("2332183394212686", "XUAN THAI (việt)")], LUAT)
        assert sorted(moi) == [("111", "Hồ Lý 11", "antalo"), ("2332183394212686", "XUAN THAI (việt)", "hat_giong")]
        pg.execute("UPDATE tkqc SET loai = 'khac', da_xac_nhan = true WHERE account_id = '111'")   # người đổi trên trang
        assert ghi_danh_ba(pg, [_meta("111", "Hồ Lý 11 (đổi tên)", st=2)], LUAT) == []
        assert pg.execute("SELECT loai, ten, trang_thai, da_xac_nhan FROM tkqc WHERE account_id = '111'").fetchone() == (
            "khac", "Hồ Lý 11 (đổi tên)", 2, True)

    def test_view_chi_tinh_tk_vao_bao_cao_doi_loai_co_tac_dung_ngay(self, pg):
        from sync.core import pg_writer
        from sync.core.pg_view import dung_view
        ghi_danh_ba(pg, [_meta("111", "Hồ Lý 11"), _meta("2332183394212686", "XUAN THAI (việt)"),
                         _meta("333", "Canada", tien="USD")], LUAT)
        dong = lambda aid, tien: {"ad_id": f"ad{aid}", "account_id": aid, "date": "2026-11-03", "spend": tien,
                                  "campaign_name": "TW/LOC/PHI/042/Trang/0311", "sync_time": "t1"}
        pg_writer.ghi_ads(pg, [dong("111", 100.0), dong("2332183394212686", 50.0), dong("333", 7.0),
                               dong("999", 3.0)], "fb_ads_tat_ca", "ad_id")
        dung_view(pg, ep=True)
        tong = lambda bang: pg.execute(f"SELECT COALESCE(SUM(spend), 0) FROM {bang}").fetchone()[0]
        assert tong("fb_ads_tat_ca") == 160.0                 # thống kê đủ mọi TK
        assert tong("fb_ads_data") == 103.0                   # Hồ Lý (antalo) + TK chưa có trong danh bạ (mặc định)
        assert tong("vw_fb_ads_std") == 103.0
        pg.execute("UPDATE tkqc SET loai = 'hat_giong' WHERE account_id = '111'")
        assert tong("fb_ads_data") == 3.0                     # không cần dựng lại view


class TestNhieuToken:
    def test_cac_token_theo_thu_tu_bo_o_trong(self):
        from sync.core.tkqc import cac_token
        env = {"TALPHA_META_ACCESS_TOKEN_3": "c", "TALPHA_META_ACCESS_TOKEN": "a", "TALPHA_META_ACCESS_TOKEN_2": " "}
        assert cac_token(env) == [("TALPHA_META_ACCESS_TOKEN", "a"), ("TALPHA_META_ACCESS_TOKEN_3", "c")]

    def test_tk_thuoc_token_dau_tien_thay_no(self, pg, monkeypatch):
        from sync.core import tkqc as T
        thay = {"moi": [_meta("1", "Hồ Lý 11"), _meta("2", "Dùng chung")],
                "cu": [_meta("2", "Dùng chung"), _meta("3", "XT ANTALO 03", st=2)]}
        monkeypatch.setattr(T, "doc_tkqc_token", lambda tok: thay[tok])
        ds = T.tkqc_can_keo(pg, [("TALPHA_META_ACCESS_TOKEN", "moi"), ("TALPHA_META_ACCESS_TOKEN_2", "cu")], LUAT)
        assert {d["id"]: d["token"] for d in ds} == {"act_1": "moi", "act_2": "moi", "act_3": "cu"}
        assert dict(pg.execute("SELECT account_id, bien_token FROM tkqc").fetchall()) == {
            "1": "TALPHA_META_ACCESS_TOKEN", "2": "TALPHA_META_ACCESS_TOKEN", "3": "TALPHA_META_ACCESS_TOKEN_2"}

    def test_mot_token_chet_van_keo_token_con_lai(self, pg, monkeypatch):
        from sync.core import tkqc as T

        def doc(tok):
            if tok == "chet":
                raise RuntimeError("Session has expired")
            return [_meta("3", "XT ANTALO 03")]
        monkeypatch.setattr(T, "doc_tkqc_token", doc)
        ds = T.tkqc_can_keo(pg, [("TALPHA_META_ACCESS_TOKEN", "chet"), ("TALPHA_META_ACCESS_TOKEN_2", "cu")], LUAT)
        assert [(d["id"], d["bien"]) for d in ds] == [("act_3", "TALPHA_META_ACCESS_TOKEN_2")]
