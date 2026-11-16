"""
Khoá kết nối (token Meta, key POS từng shop, token Pancake, key 17TRACK) — bảng `api_credentials`
(15/11/2026, migration 0006). Trước đó nằm ở dashboard-ui/.env.khoa.local.

Giám đốc dán khoá ở /admin → Khoá kết nối; dashboard gọi thử rồi mới ghi. Giá trị MÃ HOÁ bằng
pgcrypto (pgp_sym_encrypt) với chìa ở biến môi trường TALPHA_ENCRYPTION_KEY — như APP_KEY của
Laravel: bản sao lưu database, hay câu SQL đọc nhầm bảng, chỉ thấy chuỗi đã mã hoá.

Mọi tiến trình Python cần khoá (sync, danh mục SP, vòng ghi báo cáo, lịch Docker) gọi
load_credentials_to_env() lúc bắt đầu: khoá trong kho THẮNG khoá cùng tên trong .env.local — đúng thứ tự
dashboard đọc (lib/talpha/credentials.ts → docKhoa).
"""
import os
import sys

ENCRYPTION_KEY_VAR = "TALPHA_ENCRYPTION_KEY"


def get_encryption_key() -> str:
    return (os.environ.get(ENCRYPTION_KEY_VAR) or "").strip()


def read_credentials(conn) -> dict:
    """{tên: giá trị đã giải mã} của mọi khoá trong kho. Thiếu chìa → ném lỗi (đừng im lặng chạy
    bằng khoá cũ trong .env.local mà tưởng là khoá mới)."""
    secret = get_encryption_key()
    if not secret:
        raise RuntimeError(f"chưa đặt {ENCRYPTION_KEY_VAR} — không giải mã được khoá kết nối trong kho")
    rows = conn.execute(
        "SELECT name, public.pgp_sym_decrypt(encrypted_value, %s) FROM api_credentials", (secret,)).fetchall()
    return {name: value for name, value in rows}


def save_credential(conn, ten: str, gia_tri: str, note: str = "", updated_by: str = "") -> None:
    chia = get_encryption_key()
    if not chia:
        raise RuntimeError(f"chưa đặt {ENCRYPTION_KEY_VAR} — không mã hoá được khoá")
    conn.execute(
        "INSERT INTO api_credentials (name, encrypted_value, note, updated_by, updated_at) "
        "VALUES (%s, public.pgp_sym_encrypt(%s, %s), %s, %s, now()) "
        "ON CONFLICT (name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, note = EXCLUDED.note, "
        "updated_by = EXCLUDED.updated_by, updated_at = now()",
        (ten, gia_tri, chia, note or None, updated_by or None))


def load_credentials_to_env(env=None) -> list:
    """Đổ khoá trong kho vào `env` (mặc định os.environ). Trả danh sách tên đã nạp.

    Không có DATABASE_URL (máy chủ còn chạy bản cũ) → không làm gì. Kho lỗi / thiếu chìa → KÊU ra
    stderr rồi chạy tiếp bằng khoá trong .env.local: một vòng sync thiếu khoá vẫn hơn sập cả vòng."""
    env = os.environ if env is None else env
    if not (os.environ.get("DATABASE_URL") or "").strip():
        return []
    try:
        from sync.core.pg import get_connection
        with get_connection() as conn:
            credentials = read_credentials(conn)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  không đọc được khoá kết nối trong kho ({e}) — dùng khoá trong .env.local", file=sys.stderr)
        return []
    for ten, gia_tri in credentials.items():
        if gia_tri:
            env[ten] = gia_tri
    return sorted(credentials)
