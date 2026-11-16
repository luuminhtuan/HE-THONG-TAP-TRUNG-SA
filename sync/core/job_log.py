"""
Sổ lượt chạy việc nền + yêu cầu "Cập nhật ngay" (15/11/2026, migration 0007).

  job_runs          lịch (ops/docker/lich.py) ghi mỗi lượt: bắt đầu → xong / hỏng, ai chạy, mấy dòng log cuối
  refresh_requests  dashboard ghi yêu cầu khi người dùng bấm "Cập nhật ngay"; lịch nhặt rồi chạy

Dashboard đọc hai bảng này (/api/talpha/refresh) để hiện "Đang cập nhật…" / "Cập nhật lúc 18:57".
Mọi hàm ở đây NUỐT lỗi kho (chỉ in cảnh báo): ghi sổ hỏng không được làm hỏng việc nền.
"""
import sys

from sync.core.pg import get_connection


def _warn(action: str, e: Exception) -> None:
    print(f"⚠️  job_log {action}: {e}", file=sys.stderr, flush=True)


def start_run(job: str, triggered_by: str = "lịch") -> int | None:
    """Ghi một lượt đang chạy. Trả id để ghi xong."""
    try:
        with get_connection() as c:
            return c.execute("INSERT INTO job_runs (job, triggered_by) VALUES (%s, %s) RETURNING id",
                             (job, triggered_by)).fetchone()[0]
    except Exception as e:  # noqa: BLE001
        _warn("bat_dau", e)
        return None


def finish_run(run_id: int | None, rc, tail: str = "") -> None:
    if run_id is None:
        return
    ok = rc == 0
    try:
        with get_connection() as c:
            c.execute("UPDATE job_runs SET finished_at = now(), status = %s, exit_code = %s, output_tail = %s "
                      "WHERE id = %s",
                      ("ok" if ok else "failed", rc if isinstance(rc, int) else None, tail[-4000:] or None, run_id))
    except Exception as e:  # noqa: BLE001
        _warn("xong", e)


def fail_stale_runs() -> None:
    """Lịch vừa bật lại: lượt nào còn 'running' là đã bị ngắt giữa chừng (container dừng) → hỏng."""
    try:
        with get_connection() as c:
            c.execute("UPDATE job_runs SET status = 'failed', finished_at = now(), "
                      "output_tail = coalesce(output_tail, '') || 'bị ngắt: lịch việc nền khởi động lại' "
                      "WHERE status = 'running'")
            c.execute("UPDATE refresh_requests SET status = 'failed', finished_at = now() WHERE status = 'running'")
    except Exception as e:  # noqa: BLE001
        _warn("don_luot_treo", e)


def claim_refresh_request() -> tuple | None:
    """Nhận yêu cầu "Cập nhật ngay" cũ nhất đang chờ (đánh dấu đang chạy). (id, người bấm) hoặc None.
    Mọi yêu cầu khác đang chờ gộp luôn vào lượt này — bấm năm lần vẫn chỉ chạy một lượt."""
    try:
        with get_connection() as c, c.transaction():
            r = c.execute("SELECT id, requested_by FROM refresh_requests WHERE status = 'pending' "
                          "ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED").fetchone()
            if not r:
                return None
            c.execute("UPDATE refresh_requests SET status = 'running', started_at = now() "
                      "WHERE status = 'pending' AND id >= %s", (r[0],))
            return r[0], r[1]
    except Exception as e:  # noqa: BLE001
        _warn("nhan_yeu_cau", e)
        return None


def finish_refresh_request(ok: bool) -> None:
    try:
        with get_connection() as c:
            c.execute("UPDATE refresh_requests SET status = %s, finished_at = now() WHERE status = 'running'",
                      ("ok" if ok else "failed",))
    except Exception as e:  # noqa: BLE001
        _warn("xong_yeu_cau", e)
