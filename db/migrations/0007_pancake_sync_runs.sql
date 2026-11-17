-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0007 — sổ lượt kéo hộp thư Pancake + nút "Tải tin mới" ở tab Tin nhắn (17/11/2026); mã lỗi từng page.
--
-- Dashboard bấm nút → ghi một dòng trigger 'manual', status 'pending'. Lượt kéo kế tiếp
-- (sync/talpha/pancake_inbox_sync.py) nhận HẾT dòng đang chờ (→ 'running'), chạy xong ghi 'ok' / 'failed' + câu tóm tắt.
-- Lượt theo lịch tự ghi một dòng 'schedule'. Máy chủ VPS gọi script mỗi phút với --if-due: không ai bấm và lượt gần
-- nhất chưa quá sync_every_minutes thì thoát luôn — nên bảng chỉ có dòng của lượt THẬT SỰ chạy. Giữ 30 ngày.
-- ═══════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pancake_sync_runs (
    id            bigserial PRIMARY KEY,
    trigger       text        NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule')),
    requested_by  text,
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ok', 'failed')),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    summary       text
);
CREATE INDEX IF NOT EXISTS pancake_sync_runs_open_idx ON pancake_sync_runs (status) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS pancake_sync_runs_started_idx ON pancake_sync_runs (started_at DESC);

REVOKE ALL ON pancake_sync_runs FROM talpha_readonly, talpha_readonly_market;

-- Mã lỗi lượt kéo gần nhất của page ('121' = page ngoài gói cước của mọi token). Page 121 chỉ hỏi lại Pancake mỗi
-- pancake_inbox.no_plan_recheck_minutes — đỡ hàng chục lượt gọi thừa mỗi lượt kéo.
ALTER TABLE pancake_pages ADD COLUMN IF NOT EXISTS last_error_code text;
