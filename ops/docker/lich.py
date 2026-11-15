"""
Lịch việc nền trong docker compose (04/11/2026) — thay các systemd timer của máy chủ, cùng giờ:

  :00 mỗi giờ   kéo đơn POS + chi tiêu Meta              sync/talpha/talpha_sync.py
  :20 mỗi giờ   dựng báo cáo tháng (+ Sheet nếu có khoá) ops/talpha_reports/daily_guarded.sh
  :40 mỗi giờ   chụp tồn kho dự phòng cho tab Kho        ops/talpha_reports/snapshot_cron.sh inventory
  05:10         làm tươi danh mục sản phẩm               sync/talpha/sync_product_catalog.py
  06:00, 21:30  nạp bảng đối tác + đồng bộ vận đơn       ops/deploy/tracking-import.sh

Giờ là giờ Việt Nam. Khoá (Meta, POS, Pancake, 17TRACK) đọc LẠI từ bảng api_credentials (15/11/2026 —
trước đó file .env.khoa.local) trước MỖI việc — khoá vừa nhập ở /admin → Khoá kết nối có tác dụng từ
việc kế tiếp, không phải khởi động lại container. Việc nào đang chạy thì lượt sau của chính nó bỏ qua (không chồng hai lượt). Mới bật container
thì chạy ngay một vòng kéo số + báo cáo, khỏi chờ tới đầu giờ.

Mỗi lượt ghi vào bảng job_runs, và mỗi 15 giây nhặt yêu cầu "Cập nhật ngay" (refresh_requests) bấm trên
dashboard (15/11/2026, sync/core/job_log.py) — người dùng thấy đang cập nhật / cập nhật lúc nào, và tự
chạy được mà không cần gõ lệnh.
"""
import os
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

REPO = "/app"
if REPO not in sys.path:
    sys.path.insert(0, REPO)
from sync.core import job_log  # noqa: E402
VN = ZoneInfo("Asia/Ho_Chi_Minh")
VIEC = [
    # (tên, phút, giờ trong ngày — None là mỗi giờ, lệnh)
    ("sync", 0, None, ["python", "sync/talpha/talpha_sync.py"]),
    ("bao_cao", 20, None, ["bash", "ops/talpha_reports/daily_guarded.sh"]),
    ("ton_kho", 40, None, ["bash", "ops/talpha_reports/snapshot_cron.sh", "inventory"]),
    ("danh_muc", 10, [5], ["python", "sync/talpha/sync_product_catalog.py"]),
    ("van_don_sang", 0, [6], ["bash", "ops/deploy/tracking-import.sh"]),
    ("van_don_toi", 30, [21], ["bash", "ops/deploy/tracking-import.sh"]),
]
_dang_chay: dict = {}


def doc_env(duong: str) -> dict:
    """KEY=giá trị mỗi dòng (bỏ dòng trống / # chú thích, bỏ nháy bao ngoài)."""
    out = {}
    try:
        with open(duong, encoding="utf-8") as fh:
            for dong in fh:
                dong = dong.strip()
                if not dong or dong.startswith("#") or "=" not in dong:
                    continue
                k, v = dong.split("=", 1)
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                out[k.strip()] = v
    except FileNotFoundError:
        pass
    return out


def moi_truong() -> dict:
    env = dict(os.environ)
    # .env.local trước, Khoá kết nối (bảng api_credentials) sau — khoá nhập trên trang thắng (như
    # docKhoa của dashboard).
    for k, v in doc_env(os.path.join(REPO, "dashboard-ui/.env.local")).items():
        if k not in ("DATABASE_URL", "TALPHA_DOC_PASSWORD", "TALPHA_ENCRYPTION_KEY"):   # compose quyết định
            env[k] = v
    if REPO not in sys.path:
        sys.path.insert(0, REPO)
    from sync.core.credentials import nap_khoa_vao_env
    nap_khoa_vao_env(env)
    return env


def chay_va_ghi(ten: str, lenh: list, ai: str = "lịch", env: dict | None = None):
    """Chạy một việc (chờ xong), in log ra như cũ, ghi lượt vào job_runs kèm 40 dòng log cuối. Trả rc."""
    id_luot = job_log.bat_dau(ten, ai)
    bat_dau = time.time()
    print(f"{datetime.now(VN):%F %T} [{ten}] bắt đầu ({ai})", flush=True)
    duoi: deque = deque(maxlen=40)
    try:
        p = subprocess.Popen(lenh, cwd=REPO, env=env or moi_truong(), stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, errors="replace")
        for dong in p.stdout:
            print(dong, end="", flush=True)
            duoi.append(dong)
        rc = p.wait()
    except Exception as e:   # noqa: BLE001
        rc = f"lỗi {e}"
        duoi.append(str(rc))
    print(f"{datetime.now(VN):%F %T} [{ten}] xong rc={rc} sau {time.time() - bat_dau:.0f}s", flush=True)
    job_log.xong(id_luot, rc, "".join(duoi))
    return rc


def chay(ten: str, lenh: list):
    if _dang_chay.get(ten):
        print(f"{datetime.now(VN):%F %T} [{ten}] lượt trước còn chạy — bỏ lượt", flush=True)
        return

    def _lam():
        _dang_chay[ten] = True
        try:
            chay_va_ghi(ten, lenh)
        finally:
            _dang_chay[ten] = False

    threading.Thread(target=_lam, daemon=True).start()


def bo_moc_bao_cao():
    """daily_guarded.sh bỏ lượt nếu lượt trước chưa quá 50 phút — lượt có chủ đích thì xoá mốc trước."""
    try:
        os.remove(os.path.join(REPO, "ops", "talpha_reports", "last_run_epoch"))
    except FileNotFoundError:
        pass


def cap_nhat_ngay():
    """Yêu cầu "Cập nhật ngay" từ dashboard: kéo số rồi dựng báo cáo, như vòng :00 + :20 gộp lại.
    Chỉ nhận khi không việc kéo số / báo cáo nào đang chạy (yêu cầu cứ chờ trong bảng)."""
    if _dang_chay.get("sync") or _dang_chay.get("bao_cao") or _dang_chay.get("cap_nhat"):
        return
    yc = job_log.nhan_yeu_cau()
    if not yc:
        return
    ai = f"bấm tay: {yc[1] or '?'}"

    def _lam():
        for k in ("cap_nhat", "sync", "bao_cao"):
            _dang_chay[k] = True
        ok = False
        try:
            rc_sync = chay_va_ghi("sync", ["python", "sync/talpha/talpha_sync.py"], ai)
            bo_moc_bao_cao()
            rc_bc = chay_va_ghi("bao_cao", ["bash", "ops/talpha_reports/daily_guarded.sh"], ai)
            ok = rc_sync == 0 and rc_bc == 0
        finally:
            job_log.xong_yeu_cau(ok)
            for k in ("cap_nhat", "sync", "bao_cao"):
                _dang_chay[k] = False

    threading.Thread(target=_lam, daemon=True).start()


def main():
    os.makedirs(os.environ.get("TALPHA_REPORTS_DIR", "/app/logs/bao_cao"), exist_ok=True)
    print(f"Lịch việc nền bật lúc {datetime.now(VN):%F %T} (giờ VN): " + ", ".join(v[0] for v in VIEC), flush=True)
    # Lượt nào còn ghi "đang chạy" là của lần bật trước, đã bị ngắt giữa chừng.
    job_log.don_luot_treo()
    # Vòng đầu ngay khi bật: kéo số rồi dựng báo cáo (báo cáo đợi sync xong).
    chay_va_ghi("sync", ["python", "sync/talpha/talpha_sync.py"], "khởi động")
    env = moi_truong()
    env["TALPHA_FORCE_FORMAT"] = "1"   # vòng đầu: ghi báo cáo cả khi sync báo lỗi (chưa nhập khoá)
    # daily_guarded.sh bỏ lượt nếu lượt trước chưa quá 50 phút — bật lại container (vừa nhập khoá) thì
    # phải dựng báo cáo ngay, nên xoá mốc trước.
    bo_moc_bao_cao()
    chay_va_ghi("bao_cao", ["bash", "ops/talpha_reports/daily_guarded.sh"], "khởi động", env)
    # Vòng khởi động đã kéo số + dựng báo cáo: bật đúng phút :00 / :20 thì đừng chạy lại lượt phút đó.
    luc_bat = datetime.now(VN).strftime("%Y-%m-%d %H:%M")
    da_chay = {("sync", luc_bat), ("bao_cao", luc_bat)}
    while True:
        bay_gio = datetime.now(VN)
        moc = bay_gio.strftime("%Y-%m-%d %H:%M")
        for ten, phut, gio, lenh in VIEC:
            if bay_gio.minute == phut and (gio is None or bay_gio.hour in gio) and (ten, moc) not in da_chay:
                da_chay.add((ten, moc))
                chay(ten, lenh)
        if len(da_chay) > 500:
            da_chay = {x for x in da_chay if x[1] == moc}
        cap_nhat_ngay()
        time.sleep(15)


if __name__ == "__main__":
    sys.exit(main())
