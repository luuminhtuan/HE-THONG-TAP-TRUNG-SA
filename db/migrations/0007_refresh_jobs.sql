-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0007 (15/11/2026) — người dùng thấy số đang cập nhật / cập nhật lúc nào, và tự bấm "Cập nhật ngay".
--
--   job_runs          sổ từng lượt việc nền (kéo số, dựng báo cáo…): bắt đầu, xong, kết quả, ai chạy.
--                     Lịch Docker (ops/docker/lich.py) ghi qua sync/core/job_log.py.
--   refresh_requests  yêu cầu "Cập nhật ngay" bấm trên dashboard (/api/talpha/refresh). Lịch Docker
--                     nhặt yêu cầu đang chờ, chạy kéo số + dựng báo cáo, ghi kết quả.
-- ═══════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS job_runs (
    id            bigserial PRIMARY KEY,
    job           text NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
    exit_code     integer,
    triggered_by  text,
    output_tail   text
);
CREATE INDEX IF NOT EXISTS job_runs_job_started ON job_runs (job, started_at DESC);

CREATE TABLE IF NOT EXISTS refresh_requests (
    id            bigserial PRIMARY KEY,
    requested_by  text,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ok', 'failed'))
);
CREATE INDEX IF NOT EXISTS refresh_requests_status ON refresh_requests (status, id);
