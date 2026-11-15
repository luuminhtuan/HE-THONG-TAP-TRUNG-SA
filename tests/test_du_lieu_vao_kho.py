"""
Dữ liệu file → Postgres (15/11/2026, migration 0006): khoá kết nối mã hoá, chép file cũ một lần,
thị trường đọc từ bảng phủ, vai chỉ đọc không thấy bảng riêng.

Chạy: DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \\
      TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_du_lieu_vao_kho.py -q
(cần Postgres — tự bỏ qua khi không nối được; dựng schema tạm rồi xoá, không đụng bảng thật)
"""
import json
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sync.core import khoa as khoa_mod  # noqa: E402
from sync.core.khoa import doc_khoa, ghi_khoa, nap_khoa_vao_env  # noqa: E402
from sync.core.nhap_file import chep_tat_ca, doc_file_khoa  # noqa: E402
from sync.core.thi_truong import doc_phu_tu_kho  # noqa: E402


@pytest.fixture
def pg(monkeypatch):
    url = os.environ.get("TALPHA_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("chưa đặt DATABASE_URL — bỏ qua phần chạy trên Postgres thật")
    psycopg = pytest.importorskip("psycopg")
    from sync.core.pg import chay_migrations, ket_noi
    try:
        conn = ket_noi(url)
    except psycopg.OperationalError as e:
        pytest.skip(f"không nối được Postgres: {e}")
    monkeypatch.setenv("TALPHA_ENCRYPTION_KEY", "chia-thu-nghiem")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    chay_migrations(conn)
    try:
        yield conn
    finally:
        conn.execute(f"DROP SCHEMA {schema} CASCADE")   # schema tạm của lần chạy này
        conn.close()


class TestKhoa:
    def test_ma_hoa_roi_doc_lai_dung(self, pg):
        ghi_khoa(pg, "TALPHA_POSCAKE_SG_KEY", "abc123", "ai lưu lúc nào", "thu")
        assert doc_khoa(pg) == {"TALPHA_POSCAKE_SG_KEY": "abc123"}
        tho = pg.execute("SELECT encrypted_value FROM api_credentials").fetchone()[0]
        assert b"abc123" not in bytes(tho)          # trong bảng chỉ có chuỗi đã mã hoá

    def test_ghi_lai_cung_ten_thi_thay(self, pg):
        ghi_khoa(pg, "TRACK17_API_KEY", "cu")
        ghi_khoa(pg, "TRACK17_API_KEY", "moi")
        assert doc_khoa(pg) == {"TRACK17_API_KEY": "moi"}

    def test_sai_chia_thi_khong_giai_ma_duoc(self, pg, monkeypatch):
        ghi_khoa(pg, "TALPHA_META_ACCESS_TOKEN", "tok")
        monkeypatch.setenv("TALPHA_ENCRYPTION_KEY", "chia-khac")
        with pytest.raises(Exception):
            doc_khoa(pg)

    def test_thieu_chia_thi_keu(self, pg, monkeypatch):
        monkeypatch.delenv("TALPHA_ENCRYPTION_KEY")
        with pytest.raises(RuntimeError):
            ghi_khoa(pg, "X_KEY", "v")

    def test_khoa_trong_kho_thang_env(self, monkeypatch):
        class Noi:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        monkeypatch.setenv("DATABASE_URL", "postgresql://khong-dung")
        monkeypatch.setattr("sync.core.pg.ket_noi", lambda *a, **k: Noi())
        monkeypatch.setattr(khoa_mod, "doc_khoa", lambda conn: {"TALPHA_POSCAKE_TW_KEY": "tu-kho"})
        env = {"TALPHA_POSCAKE_TW_KEY": "tu-env-local", "KHAC": "giu"}
        assert nap_khoa_vao_env(env) == ["TALPHA_POSCAKE_TW_KEY"]
        assert env == {"TALPHA_POSCAKE_TW_KEY": "tu-kho", "KHAC": "giu"}

    def test_khong_co_database_url_thi_bo_qua(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        env = {"A": "1"}
        assert nap_khoa_vao_env(env) == [] and env == {"A": "1"}


def _repo_gia(tmp_path: Path) -> Path:
    (tmp_path / "data" / "bao_cao_nuoc").mkdir(parents=True)
    (tmp_path / "config").mkdir()
    (tmp_path / "dashboard-ui").mkdir()
    (tmp_path / "data" / "cod_statements.json").write_text(json.dumps({"statements": [{"ky": "2026-09-11"}]}))
    (tmp_path / "data" / "tracking.json").write_text(json.dumps({"statuses": {"A1": {"status": "giao"}}}))
    (tmp_path / "data" / "thi_truong.json").write_text(json.dumps(
        {"markets": {"Thailand": {"display": "Thái Lan", "status": "sap_chay"}}, "updated_by": "sa"}))
    (tmp_path / "data" / "bao_cao_nuoc" / "2026-11.json").write_text(json.dumps({"thang": "2026-11", "nuoc": {}}))
    (tmp_path / "config" / "users.json").write_text(json.dumps([
        {"id": "1", "email": "loc", "name": "Lộc", "password": "$2a$10$h", "role": "leader", "teams": ["trung_dong"],
         "projects": ["talpha"]},
        {"id": "2", "email": "cho", "name": "Chờ", "password": "$2a$10$k", "role": "sale", "status": "pending"},
    ]))
    (tmp_path / "dashboard-ui" / ".env.khoa.local").write_text(
        "# Khoá kết nối …\n\n# TALPHA_POSCAKE_TW_KEY: sa lưu lúc 20:21\nTALPHA_POSCAKE_TW_KEY=k-tw\nTRACK17_API_KEY='k-17'\n")
    return tmp_path


class TestChepFile:
    def test_chep_du_moi_thu_mot_lan(self, pg, tmp_path):
        repo = _repo_gia(tmp_path)
        da = chep_tat_ca(pg, repo)
        assert set(da) == {"data/cod_statements.json", "data/tracking.json", "data/thi_truong.json",
                           "data/bao_cao_nuoc/2026-11.json", "config/users.json", "dashboard-ui/.env.khoa.local"}
        kho = dict(pg.execute("SELECT name, content FROM app_documents").fetchall())
        assert kho == {"cod_statements": {"statements": [{"ky": "2026-09-11"}]},
                       "tracking": {"statuses": {"A1": {"status": "giao"}}}}
        assert doc_phu_tu_kho(pg) == {"markets": {"Thailand": {"display": "Thái Lan", "status": "sap_chay"}}}
        assert pg.execute("SELECT month FROM market_monthly_reports").fetchall() == [("2026-11",)]
        nguoi = pg.execute("SELECT id, username, role, teams, projects, status FROM users ORDER BY id").fetchall()
        assert nguoi == [("1", "loc", "leader", ["trung_dong"], ["talpha"], "active"),
                         ("2", "cho", "sale", [], [], "pending")]
        assert doc_khoa(pg) == {"TALPHA_POSCAKE_TW_KEY": "k-tw", "TRACK17_API_KEY": "k-17"}
        assert pg.execute("SELECT note FROM api_credentials WHERE name = 'TALPHA_POSCAKE_TW_KEY'").fetchone()[0] \
            == "sa lưu lúc 20:21"
        assert chep_tat_ca(pg, repo) == []          # lần hai: không chép gì nữa

    def test_khong_hoi_sinh_thu_da_xoa_khong_de_du_lieu_kho(self, pg, tmp_path):
        repo = _repo_gia(tmp_path)
        # Kho đã có bản mới hơn file → giữ bản kho.
        pg.execute("INSERT INTO app_documents (name, content) VALUES ('tracking', '{\"moi\": true}')")
        chep_tat_ca(pg, repo)
        assert pg.execute("SELECT content FROM app_documents WHERE name = 'tracking'").fetchone()[0] == {"moi": True}
        # Người dùng bỏ khoá trên trang → lần migrate sau KHÔNG chép lại từ file cũ.
        pg.execute("DELETE FROM api_credentials WHERE name = 'TRACK17_API_KEY'")
        chep_tat_ca(pg, repo)
        assert set(doc_khoa(pg)) == {"TALPHA_POSCAKE_TW_KEY"}

    def test_thieu_chia_thi_chua_chep_khoa_lan_sau_chep(self, pg, tmp_path, monkeypatch):
        repo = _repo_gia(tmp_path)
        monkeypatch.delenv("TALPHA_ENCRYPTION_KEY")
        assert "dashboard-ui/.env.khoa.local" not in chep_tat_ca(pg, repo)
        monkeypatch.setenv("TALPHA_ENCRYPTION_KEY", "chia-thu-nghiem")
        assert chep_tat_ca(pg, repo) == ["dashboard-ui/.env.khoa.local"]

    def test_doc_file_khoa(self):
        khoa, ghi = doc_file_khoa("# A_KEY: ai đó\nA_KEY=1\nB_KEY=\"2\"\n#C_KEY=3\nRONG=\n")
        assert khoa == {"A_KEY": "1", "B_KEY": "2"} and ghi == {"A_KEY": "ai đó"}


class TestVaiChiDoc:
    def test_vai_chi_doc_khong_thay_bang_rieng(self, pg):
        schema = pg.execute("SELECT current_schema()").fetchone()[0]
        for bang in ("api_credentials", "users", "app_documents", "market_overrides", "market_monthly_reports"):
            for vai in ("talpha_doc", "talpha_doc_nuoc"):
                assert pg.execute("SELECT has_table_privilege(%s, %s, 'SELECT')",
                                  (vai, f"{schema}.{bang}")).fetchone()[0] is False, (vai, bang)
