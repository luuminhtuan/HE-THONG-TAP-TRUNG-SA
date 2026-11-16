#!/usr/bin/env python3
# TALPHA — ghi 1 dòng trạng thái vòng chạy vào bảng Postgres sync_health (chống "chết câm").
# Gọi từ daily_guarded.sh sau mỗi vòng chạy. Bot Zalo đọc qua /api/talpha/sync-health.
# Fail ở đây KHÔNG được làm vỡ vòng chạy.
import os, sys, socket, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import talpha_paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ok", type=int, required=True)          # 1 = cả vòng OK
    ap.add_argument("--sync-rc", type=int, default=-1)
    ap.add_argument("--format-rc", type=int, default=-1)
    ap.add_argument("--detail", default="")
    a = ap.parse_args()
    sys.path.insert(0, talpha_paths.repo_dir())
    from sync.core.pg import get_connection
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO sync_health (ts, host, ok, sync_rc, format_rc, detail) VALUES (now(), %s, %s, %s, %s, %s)",
            (socket.gethostname(), bool(a.ok), a.sync_rc, a.format_rc, a.detail[:1000]))
    print("sync_health:", bool(a.ok), a.detail[:80])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:                       # noqa: BLE001
        print("report_health FAILED (bỏ qua, không chặn vòng chạy):", e, file=sys.stderr)
