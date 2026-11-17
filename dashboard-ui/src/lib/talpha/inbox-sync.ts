// Nút "Tải tin mới" của tab Tin nhắn (17/11/2026) — đọc / ghi bảng pancake_sync_runs (migration 0007).
// Dashboard KHÔNG gọi Pancake: chỉ ghi yêu cầu 'pending'; lượt kéo kế tiếp (sync/talpha/pancake_inbox_sync.py — VPS gọi
// mỗi phút với --if-due, Docker nhặt mỗi 15 giây) nhận yêu cầu, kéo, ghi kết quả. Tab hỏi lại trạng thái tới khi xong.
// Không ai bấm thì tự kéo pancake_inbox.sync_every_minutes phút một lần (30, 17/11/2026).

const EVERY_MINUTES = Number((RULES as unknown as { pancake_inbox?: { sync_every_minutes?: number } })
    .pancake_inbox?.sync_every_minutes) || 30;
import { query } from "@/lib/db";
import { RULES } from "@/lib/talpha/rules";
import type { InboxSyncRun, InboxSyncStatus } from "@/lib/talpha/inbox-rules";

const COLS = "id, trigger, requested_by, status, requested_at, started_at, finished_at, summary";

export async function getInboxSyncStatus(): Promise<InboxSyncStatus> {
    const [open, last, seen] = await Promise.all([
        query<InboxSyncRun>(`SELECT ${COLS} FROM pancake_sync_runs WHERE status IN ('pending', 'running') ORDER BY id DESC LIMIT 1`),
        query<InboxSyncRun>(`SELECT ${COLS} FROM pancake_sync_runs WHERE status IN ('ok', 'failed') ORDER BY finished_at DESC NULLS LAST LIMIT 1`),
        query<{ at: string | null }>("SELECT max(started_at) AS at FROM pancake_sync_runs"),
    ]);
    return { open: open[0] ?? null, last: last[0] ?? null, runner_seen_at: seen[0]?.at ?? null, every_minutes: EVERY_MINUTES };
}

/** Ghi yêu cầu kéo ngay. Đang có yêu cầu chờ / lượt đang chạy thì không ghi thêm (lượt đó trả lời luôn). */
export async function requestInboxSync(actor: string): Promise<{ queued: boolean }> {
    const rows = await query<{ id: number }>(
        `INSERT INTO pancake_sync_runs (trigger, requested_by)
         SELECT 'manual', @actor
          WHERE NOT EXISTS (SELECT 1 FROM pancake_sync_runs WHERE status IN ('pending', 'running'))
         RETURNING id`, { actor: actor.slice(0, 120) });
    return { queued: rows.length > 0 };
}
