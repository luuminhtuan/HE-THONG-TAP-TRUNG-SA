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
JOBS = [
    # (tên, phút, giờ trong ngày — None là mỗi giờ, lệnh)
    ("sync", 0, None, ["python", "sync/talpha/talpha_sync.py"]),
    ("bao_cao", 20, None, ["bash", "ops/talpha_reports/daily_guarded.sh"]),
    ("ton_kho", 40, None, ["bash", "ops/talpha_reports/snapshot_cron.sh", "inventory"]),
    ("danh_muc", 10, [5], ["python", "sync/talpha/sync_product_catalog.py"]),
    ("van_don_sang", 0, [6], ["bash", "ops/deploy/tracking-import.sh"]),
    ("van_don_toi", 30, [21], ["bash", "ops/deploy/tracking-import.sh"]),
]
_running: dict = {}


def read_env_file(path: str) -> dict:
    """KEY=giá trị mỗi dòng (bỏ dòng trống / # chú thích, bỏ nháy bao ngoài)."""
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                out[k.strip()] = v
    except FileNotFoundError:
        pass
    return out


def build_env() -> dict:
    env = dict(os.environ)
    # .env.local trước, Khoá kết nối (bảng api_credentials) sau — khoá nhập trên trang thắng (như
    # docKhoa của dashboard).
    for k, v in read_env_file(os.path.join(REPO, "dashboard-ui/.env.local")).items():
        if k not in ("DATABASE_URL", "TALPHA_DOC_PASSWORD", "TALPHA_ENCRYPTION_KEY"):   # compose quyết định
            env[k] = v
    if REPO not in sys.path:
        sys.path.insert(0, REPO)
    from sync.core.credentials import load_credentials_to_env
    load_credentials_to_env(env)
    return env


def run_and_log(name: str, command: list, triggered_by: str = "lịch", env: dict | None = None):
    """Chạy một việc (chờ xong), in log ra như cũ, ghi lượt vào job_runs kèm 40 dòng log cuối. Trả rc."""
    run_id = job_log.start_run(name, triggered_by)
    start_time = time.time()
    print(f"{datetime.now(VN):%F %T} [{name}] bắt đầu ({triggered_by})", flush=True)
    tail: deque = deque(maxlen=40)
    try:
        p = subprocess.Popen(command, cwd=REPO, env=env or build_env(), stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, errors="replace")
        for line in p.stdout:
            print(line, end="", flush=True)
            tail.append(line)
        rc = p.wait()
    except Exception as e:   # noqa: BLE001
        rc = f"lỗi {e}"
        tail.append(str(rc))
    print(f"{datetime.now(VN):%F %T} [{name}] xong rc={rc} sau {time.time() - start_time:.0f}s", flush=True)
    job_log.finish_run(run_id, rc, "".join(tail))
    return rc


def start_job(name: str, command: list):
    if _running.get(name):
        print(f"{datetime.now(VN):%F %T} [{name}] lượt trước còn chạy — bỏ lượt", flush=True)
        return

    def _worker():
        _running[name] = True
        try:
            run_and_log(name, command)
        finally:
            _running[name] = False

    threading.Thread(target=_worker, daemon=True).start()


def clear_report_marker():
    """daily_guarded.sh bỏ lượt nếu lượt trước chưa quá 50 phút — lượt có chủ đích thì xoá mốc trước."""
    try:
        os.remove(os.path.join(REPO, "ops", "talpha_reports", "last_run_epoch"))
    except FileNotFoundError:
        pass


def handle_refresh_request():
    """Yêu cầu "Cập nhật ngay" từ dashboard: kéo số rồi dựng báo cáo, như vòng :00 + :20 gộp lại.
    Chỉ nhận khi không việc kéo số / báo cáo nào đang chạy (yêu cầu cứ chờ trong bảng)."""
    if _running.get("sync") or _running.get("bao_cao") or _running.get("cap_nhat"):
        return
    request = job_log.claim_refresh_request()
    if not request:
        return
    ai = f"bấm tay: {request[1] or '?'}"

    def _run():
        for k in ("cap_nhat", "sync", "bao_cao"):
            _running[k] = True
        ok = False
        try:
            rc_sync = run_and_log("sync", ["python", "sync/talpha/talpha_sync.py"], ai)
            clear_report_marker()
            rc_report = run_and_log("bao_cao", ["bash", "ops/talpha_reports/daily_guarded.sh"], ai)
            ok = rc_sync == 0 and rc_report == 0
        finally:
            job_log.finish_refresh_request(ok)
            for k in ("cap_nhat", "sync", "bao_cao"):
                _running[k] = False

    threading.Thread(target=_run, daemon=True).start()


def main():
    os.makedirs(os.environ.get("TALPHA_REPORTS_DIR", "/app/logs/bao_cao"), exist_ok=True)
    print(f"Lịch việc nền bật lúc {datetime.now(VN):%F %T} (giờ VN): " + ", ".join(v[0] for v in JOBS), flush=True)
    # Lượt nào còn ghi "đang chạy" là của lần bật trước, đã bị ngắt giữa chừng.
    job_log.fail_stale_runs()
    # Vòng đầu ngay khi bật: kéo số rồi dựng báo cáo (báo cáo đợi sync xong).
    run_and_log("sync", ["python", "sync/talpha/talpha_sync.py"], "khởi động")
    env = build_env()
    env["TALPHA_FORCE_FORMAT"] = "1"   # vòng đầu: ghi báo cáo cả khi sync báo lỗi (chưa nhập khoá)
    # daily_guarded.sh bỏ lượt nếu lượt trước chưa quá 50 phút — bật lại container (vừa nhập khoá) thì
    # phải dựng báo cáo ngay, nên xoá mốc trước.
    clear_report_marker()
    run_and_log("bao_cao", ["bash", "ops/talpha_reports/daily_guarded.sh"], "khởi động", env)
    # Vòng khởi động đã kéo số + dựng báo cáo: bật đúng phút :00 / :20 thì đừng chạy lại lượt phút đó.
    boot_slot = datetime.now(VN).strftime("%Y-%m-%d %H:%M")
    already_run = {("sync", boot_slot), ("bao_cao", boot_slot)}
    while True:
        now = datetime.now(VN)
        slot = now.strftime("%Y-%m-%d %H:%M")
        for name, minute, hours, command in JOBS:
            if now.minute == minute and (hours is None or now.hour in hours) and (name, slot) not in already_run:
                already_run.add((name, slot))
                start_job(name, command)
        if len(already_run) > 500:
            already_run = {x for x in already_run if x[1] == slot}
        handle_refresh_request()
        time.sleep(15)


if __name__ == "__main__":
    sys.exit(main())
