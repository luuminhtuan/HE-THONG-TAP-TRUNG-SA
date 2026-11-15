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
"""
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

REPO = "/app"
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


def chay(ten: str, lenh: list):
    if _dang_chay.get(ten):
        print(f"{datetime.now(VN):%F %T} [{ten}] lượt trước còn chạy — bỏ lượt", flush=True)
        return

    def _lam():
        _dang_chay[ten] = True
        bat_dau = time.time()
        print(f"{datetime.now(VN):%F %T} [{ten}] bắt đầu", flush=True)
        try:
            rc = subprocess.run(lenh, cwd=REPO, env=moi_truong()).returncode
        except Exception as e:   # noqa: BLE001
            rc = f"lỗi {e}"
        print(f"{datetime.now(VN):%F %T} [{ten}] xong rc={rc} sau {time.time() - bat_dau:.0f}s", flush=True)
        _dang_chay[ten] = False

    threading.Thread(target=_lam, daemon=True).start()


def main():
    os.makedirs(os.environ.get("TALPHA_REPORTS_DIR", "/app/logs/bao_cao"), exist_ok=True)
    print(f"Lịch việc nền bật lúc {datetime.now(VN):%F %T} (giờ VN): " + ", ".join(v[0] for v in VIEC), flush=True)
    # Vòng đầu ngay khi bật: kéo số rồi dựng báo cáo (báo cáo đợi sync xong).
    subprocess.run(["python", "sync/talpha/talpha_sync.py"], cwd=REPO, env=moi_truong())
    env = moi_truong()
    env["TALPHA_FORCE_FORMAT"] = "1"   # vòng đầu: ghi báo cáo cả khi sync báo lỗi (chưa nhập khoá)
    # daily_guarded.sh bỏ lượt nếu lượt trước chưa quá 50 phút — bật lại container (vừa nhập khoá) thì
    # phải dựng báo cáo ngay, nên xoá mốc trước.
    try:
        os.remove(os.path.join(REPO, "ops", "talpha_reports", "last_run_epoch"))
    except FileNotFoundError:
        pass
    subprocess.run(["bash", "ops/talpha_reports/daily_guarded.sh"], cwd=REPO, env=env)
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
        time.sleep(15)


if __name__ == "__main__":
    sys.exit(main())
