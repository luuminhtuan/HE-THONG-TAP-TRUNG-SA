"""
Dữ liệu file → Postgres (15/11/2026, migration 0006): khoá kết nối mã hoá, chép file cũ một lần,
thị trường đọc từ bảng phủ, vai chỉ đọc không thấy bảng riêng.

Chạy: DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha \\
      TALPHA_RULES="$PWD/config/talpha_rules.json" python3 -m pytest tests/test_db_storage.py -q
(cần Postgres — tự bỏ qua khi không nối được; dựng schema tạm rồi xoá, không đụng bảng thật)
"""
import json
import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sync.core import credentials as credentials_mod  # noqa: E402
from sync.core.credentials import read_credentials, save_credential, load_credentials_to_env  # noqa: E402
from sync.core.file_import import import_all, parse_credentials_file  # noqa: E402
from sync.core.market_config import read_market_overrides_from_db  # noqa: E402


@pytest.fixture
def pg(monkeypatch):
    url = os.environ.get("TALPHA_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("chưa đặt DATABASE_URL — bỏ qua phần chạy trên Postgres thật")
    psycopg = pytest.importorskip("psycopg")
    from sync.core.pg import run_migrations, get_connection
    try:
        conn = get_connection(url)
    except psycopg.OperationalError as e:
        pytest.skip(f"không nối được Postgres: {e}")
    monkeypatch.setenv("TALPHA_ENCRYPTION_KEY", "chia-thu-nghiem")
    schema = f"test_{uuid.uuid4().hex[:10]}"
    conn.execute(f"CREATE SCHEMA {schema}")
    conn.execute(f"SET search_path TO {schema}")
    run_migrations(conn)
    try:
        yield conn
    finally:
        conn.execute(f"DROP SCHEMA {schema} CASCADE")   # schema tạm của lần chạy này
        conn.close()


class TestCredentials:
    def test_encrypt_then_read_back(self, pg):
        save_credential(pg, "TALPHA_POSCAKE_SG_KEY", "abc123", "ai lưu lúc nào", "thu")
        assert read_credentials(pg) == {"TALPHA_POSCAKE_SG_KEY": "abc123"}
        raw = pg.execute("SELECT encrypted_value FROM api_credentials").fetchone()[0]
        assert b"abc123" not in bytes(raw)          # trong bảng chỉ có chuỗi đã mã hoá

    def test_rewrite_same_name_replaces(self, pg):
        save_credential(pg, "TRACK17_API_KEY", "cu")
        save_credential(pg, "TRACK17_API_KEY", "moi")
        assert read_credentials(pg) == {"TRACK17_API_KEY": "moi"}

    def test_wrong_key_cannot_decrypt(self, pg, monkeypatch):
        save_credential(pg, "TALPHA_META_ACCESS_TOKEN", "tok")
        monkeypatch.setenv("TALPHA_ENCRYPTION_KEY", "chia-khac")
        with pytest.raises(Exception):
            read_credentials(pg)

    def test_missing_key_raises(self, pg, monkeypatch):
        monkeypatch.delenv("TALPHA_ENCRYPTION_KEY")
        with pytest.raises(RuntimeError):
            save_credential(pg, "X_KEY", "v")

    def test_db_credential_overrides_env_file(self, monkeypatch):
        class FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False
        monkeypatch.setenv("DATABASE_URL", "postgresql://khong-dung")
        monkeypatch.setattr("sync.core.pg.get_connection", lambda *a, **k: FakeConn())
        monkeypatch.setattr(credentials_mod, "read_credentials", lambda conn: {"TALPHA_POSCAKE_TW_KEY": "tu-kho"})
        env = {"TALPHA_POSCAKE_TW_KEY": "tu-env-local", "KHAC": "giu"}
        assert load_credentials_to_env(env) == ["TALPHA_POSCAKE_TW_KEY"]
        assert env == {"TALPHA_POSCAKE_TW_KEY": "tu-kho", "KHAC": "giu"}

    def test_no_database_url_skips(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        env = {"A": "1"}
        assert load_credentials_to_env(env) == [] and env == {"A": "1"}


def _fake_repo(tmp_path: Path) -> Path:
    (tmp_path / "data" / "bao_cao_nuoc").mkdir(parents=True)
    (tmp_path / "config").mkdir()
    (tmp_path / "dashboard-ui").mkdir()
    (tmp_path / "data" / "cod_statements.json").write_text(json.dumps({"statements": [{"ky": "2026-09-11"}]}))
    (tmp_path / "data" / "tracking.json").write_text(json.dumps({"statuses": {"A1": {"status": "giao"}}}))
    (tmp_path / "data" / "thi_truong.json").write_text(json.dumps(
        {"markets": {"Thailand": {"display": "Thái Lan", "status": "upcoming"}}, "updated_by": "sa"}))
    (tmp_path / "data" / "bao_cao_nuoc" / "2026-11.json").write_text(json.dumps({"thang": "2026-11", "nuoc": {}}))
    (tmp_path / "config" / "users.json").write_text(json.dumps([
        {"id": "1", "email": "loc", "name": "Lộc", "password": "$2a$10$h", "role": "leader", "teams": ["trung_dong"],
         "projects": ["talpha"]},
        {"id": "2", "email": "cho", "name": "Chờ", "password": "$2a$10$k", "role": "sale", "status": "pending"},
    ]))
    (tmp_path / "dashboard-ui" / ".env.khoa.local").write_text(
        "# Khoá kết nối …\n\n# TALPHA_POSCAKE_TW_KEY: sa lưu lúc 20:21\nTALPHA_POSCAKE_TW_KEY=k-tw\nTRACK17_API_KEY='k-17'\n")
    return tmp_path


class TestFileImport:
    def test_imports_everything_once(self, pg, tmp_path):
        repo = _fake_repo(tmp_path)
        imported = import_all(pg, repo)
        assert set(imported) == {"data/cod_statements.json", "data/tracking.json", "data/thi_truong.json",
                           "data/bao_cao_nuoc/2026-11.json", "config/users.json", "dashboard-ui/.env.khoa.local"}
        documents = dict(pg.execute("SELECT name, content FROM app_documents").fetchall())
        assert documents == {"cod_statements": {"statements": [{"ky": "2026-09-11"}]},
                       "tracking": {"statuses": {"A1": {"status": "giao"}}}}
        assert read_market_overrides_from_db(pg) == {"markets": {"Thailand": {"display": "Thái Lan", "status": "upcoming"}}}
        assert pg.execute("SELECT month FROM market_monthly_reports").fetchall() == [("2026-11",)]
        users = pg.execute("SELECT id, username, role, teams, projects, status FROM users ORDER BY id").fetchall()
        assert users == [("1", "loc", "leader", ["trung_dong"], ["talpha"], "active"),
                         ("2", "cho", "sale", [], [], "pending")]
        assert read_credentials(pg) == {"TALPHA_POSCAKE_TW_KEY": "k-tw", "TRACK17_API_KEY": "k-17"}
        assert pg.execute("SELECT note FROM api_credentials WHERE name = 'TALPHA_POSCAKE_TW_KEY'").fetchone()[0] \
            == "sa lưu lúc 20:21"
        assert import_all(pg, repo) == []          # lần hai: không chép gì nữa

    def test_no_resurrect_deleted_or_overwrite_db(self, pg, tmp_path):
        repo = _fake_repo(tmp_path)
        # Kho đã có bản mới hơn file → giữ bản kho.
        pg.execute("INSERT INTO app_documents (name, content) VALUES ('tracking', '{\"moi\": true}')")
        import_all(pg, repo)
        assert pg.execute("SELECT content FROM app_documents WHERE name = 'tracking'").fetchone()[0] == {"moi": True}
        # Người dùng bỏ khoá trên trang → lần migrate sau KHÔNG chép lại từ file cũ.
        pg.execute("DELETE FROM api_credentials WHERE name = 'TRACK17_API_KEY'")
        import_all(pg, repo)
        assert set(read_credentials(pg)) == {"TALPHA_POSCAKE_TW_KEY"}

    def test_missing_key_defers_credential_import(self, pg, tmp_path, monkeypatch):
        repo = _fake_repo(tmp_path)
        monkeypatch.delenv("TALPHA_ENCRYPTION_KEY")
        assert "dashboard-ui/.env.khoa.local" not in import_all(pg, repo)
        monkeypatch.setenv("TALPHA_ENCRYPTION_KEY", "chia-thu-nghiem")
        assert import_all(pg, repo) == ["dashboard-ui/.env.khoa.local"]

    def test_parse_credentials_file(self):
        credentials, notes = parse_credentials_file("# A_KEY: ai đó\nA_KEY=1\nB_KEY=\"2\"\n#C_KEY=3\nRONG=\n")
        assert credentials == {"A_KEY": "1", "B_KEY": "2"} and notes == {"A_KEY": "ai đó"}


class TestReadOnlyRole:
    def test_readonly_role_cannot_see_private_tables(self, pg):
        schema = pg.execute("SELECT current_schema()").fetchone()[0]
        for table in ("api_credentials", "users", "app_documents", "market_overrides", "market_monthly_reports"):
            for role in ("talpha_readonly", "talpha_readonly_market"):
                assert pg.execute("SELECT has_table_privilege(%s, %s, 'SELECT')",
                                  (role, f"{schema}.{table}")).fetchone()[0] is False, (role, table)
