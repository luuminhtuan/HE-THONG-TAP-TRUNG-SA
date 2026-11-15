"""
Khoá kết nối (token Meta, key POS từng shop, token Pancake, key 17TRACK) — bảng `api_credentials`
(15/11/2026, migration 0006). Trước đó nằm ở dashboard-ui/.env.khoa.local.

Giám đốc dán khoá ở /admin → Khoá kết nối; dashboard gọi thử rồi mới ghi. Giá trị MÃ HOÁ bằng
pgcrypto (pgp_sym_encrypt) với chìa ở biến môi trường TALPHA_ENCRYPTION_KEY — như APP_KEY của
Laravel: bản sao lưu database, hay câu SQL đọc nhầm bảng, chỉ thấy chuỗi đã mã hoá.

Mọi tiến trình Python cần khoá (sync, danh mục SP, vòng ghi báo cáo, lịch Docker) gọi
nap_khoa_vao_env() lúc bắt đầu: khoá trong kho THẮNG khoá cùng tên trong .env.local — đúng thứ tự
dashboard đọc (lib/talpha/khoa.ts → docKhoa).
"""
import os
import sys

BIEN_CHIA = "TALPHA_ENCRYPTION_KEY"


def chia_ma_hoa() -> str:
    return (os.environ.get(BIEN_CHIA) or "").strip()


def doc_khoa(conn) -> dict:
    """{tên: giá trị đã giải mã} của mọi khoá trong kho. Thiếu chìa → ném lỗi (đừng im lặng chạy
    bằng khoá cũ trong .env.local mà tưởng là khoá mới)."""
    chia = chia_ma_hoa()
    if not chia:
        raise RuntimeError(f"chưa đặt {BIEN_CHIA} — không giải mã được khoá kết nối trong kho")
    rows = conn.execute(
        "SELECT name, public.pgp_sym_decrypt(encrypted_value, %s) FROM api_credentials", (chia,)).fetchall()
    return {ten: gia_tri for ten, gia_tri in rows}


def ghi_khoa(conn, ten: str, gia_tri: str, ghi_chu: str = "", ai: str = "") -> None:
    chia = chia_ma_hoa()
    if not chia:
        raise RuntimeError(f"chưa đặt {BIEN_CHIA} — không mã hoá được khoá")
    conn.execute(
        "INSERT INTO api_credentials (name, encrypted_value, note, updated_by, updated_at) "
        "VALUES (%s, public.pgp_sym_encrypt(%s, %s), %s, %s, now()) "
        "ON CONFLICT (name) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, note = EXCLUDED.note, "
        "updated_by = EXCLUDED.updated_by, updated_at = now()",
        (ten, gia_tri, chia, ghi_chu or None, ai or None))


def nap_khoa_vao_env(env=None) -> list:
    """Đổ khoá trong kho vào `env` (mặc định os.environ). Trả danh sách tên đã nạp.

    Không có DATABASE_URL (máy chủ còn chạy bản cũ) → không làm gì. Kho lỗi / thiếu chìa → KÊU ra
    stderr rồi chạy tiếp bằng khoá trong .env.local: một vòng sync thiếu khoá vẫn hơn sập cả vòng."""
    env = os.environ if env is None else env
    if not (os.environ.get("DATABASE_URL") or "").strip():
        return []
    try:
        from sync.core.pg import ket_noi
        with ket_noi() as conn:
            khoa = doc_khoa(conn)
    except Exception as e:  # noqa: BLE001
        print(f"⚠️  không đọc được khoá kết nối trong kho ({e}) — dùng khoá trong .env.local", file=sys.stderr)
        return []
    for ten, gia_tri in khoa.items():
        if gia_tri:
            env[ten] = gia_tri
    return sorted(khoa)
