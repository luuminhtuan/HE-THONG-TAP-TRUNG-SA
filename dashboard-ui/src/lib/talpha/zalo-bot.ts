// ═══════════════════════════════════════════════════════════════════
// Bot Zalo điều khiển từ trang (16/11/2026) — phần ĐỤNG KHO: bảng zalo_bot_status (bot ghi trạng thái) và
// zalo_requests (trang ghi yêu cầu, bot nhặt). Migration 0002. Phần thuần (soát yêu cầu): zalo-bot-rules.ts.
// ═══════════════════════════════════════════════════════════════════
import { query, withTransaction } from "@/lib/db";
import { isBotOnline, STALE_RUNNING_MS, type ZaloRequestInput } from "./zalo-bot-rules";

export type ZaloGroup = { id: string; name: string; members?: number | null };
export type ZaloPairing = { stage: "qr" | "scanned" | "done" | "failed"; qr_png?: string | null; message?: string | null; at?: string };
export type ZaloStatus = {
    logged_in: boolean;
    account_name: string | null;
    markets: string[];
    groups: ZaloGroup[];
    market_groups: Record<string, { id: string; name: string }>;
    pairing: ZaloPairing | null;
    last_error: string | null;
    heartbeat_at: string | null;
    updated_at: string | null;
};
export type ZaloRequestRow = {
    id: number; action: string; payload: Record<string, string>; requested_by: string | null;
    requested_at: string; started_at: string | null; finished_at: string | null;
    status: "pending" | "running" | "ok" | "failed"; result: string | null;
};

const STATUS_COLUMNS = "logged_in, account_name, markets, groups, market_groups, pairing, last_error, heartbeat_at, updated_at";
const REQUEST_COLUMNS = "id, action, payload, requested_by, requested_at, started_at, finished_at, status, result";

export async function getZaloOverview(): Promise<{ status: ZaloStatus | null; online: boolean; requests: ZaloRequestRow[] }> {
    const [status] = await query<ZaloStatus>(`SELECT ${STATUS_COLUMNS} FROM zalo_bot_status WHERE id = 1`);
    const requests = await query<ZaloRequestRow>(`SELECT ${REQUEST_COLUMNS} FROM zalo_requests ORDER BY id DESC LIMIT 8`);
    return { status: status || null, online: isBotOnline(status?.heartbeat_at), requests };
}

/** Ghi yêu cầu. Việc y hệt đang chờ / đang chạy thì không ghi thêm (bấm hai lần). */
export async function enqueueZaloRequest(input: ZaloRequestInput, actor: string): Promise<{ id: number; duplicate: boolean }> {
    return withTransaction(async (q) => {
        const [existing] = await q<{ id: number }>(
            `SELECT id FROM zalo_requests WHERE status IN ('pending', 'running') AND action = @action AND payload = @payload::jsonb
             ORDER BY id DESC LIMIT 1`, { action: input.action, payload: JSON.stringify(input.payload) });
        if (existing) return { id: Number(existing.id), duplicate: true };
        const [row] = await q<{ id: number }>(
            `INSERT INTO zalo_requests (action, payload, requested_by) VALUES (@action, @payload::jsonb, @actor) RETURNING id`,
            { action: input.action, payload: JSON.stringify(input.payload), actor });
        return { id: Number(row.id), duplicate: false };
    });
}

/** Bot nhặt yêu cầu cũ nhất đang chờ. Yêu cầu "running" quá lâu (bot dừng giữa chừng) thì đóng là lỗi trước. */
export async function claimZaloRequest(): Promise<ZaloRequestRow | null> {
    await query(
        `UPDATE zalo_requests SET status = 'failed', finished_at = now(), result = 'Bot dừng giữa chừng — bấm lại'
         WHERE status = 'running' AND started_at < now() - make_interval(secs => @staleSeconds)`,
        { staleSeconds: STALE_RUNNING_MS / 1000 });
    const [row] = await query<ZaloRequestRow>(
        `UPDATE zalo_requests SET status = 'running', started_at = now()
         WHERE id = (SELECT id FROM zalo_requests WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING ${REQUEST_COLUMNS}`);
    return row || null;
}

export async function finishZaloRequest(id: number, ok: boolean, result: string): Promise<void> {
    await query(
        `UPDATE zalo_requests SET status = @status, finished_at = now(), result = @result WHERE id = @id AND status = 'running'`,
        { id, status: ok ? "ok" : "failed", result: result.slice(0, 2000) });
}

// Cột bot được ghi + cách đưa vào SQL. Danh sách cố định: tên cột không bao giờ lấy từ body.
const STATUS_FIELDS: Record<string, "bool" | "text" | "json"> = {
    logged_in: "bool", account_name: "text", markets: "json", groups: "json", market_groups: "json",
    pairing: "json", last_error: "text",
};

/** Bot ghi trạng thái (chỉ các trường có trong `patch`) + nhịp tim. */
export async function updateZaloStatus(patch: Record<string, unknown>): Promise<void> {
    const params: Record<string, unknown> = {};
    const sets: string[] = [];
    for (const [field, kind] of Object.entries(STATUS_FIELDS)) {
        if (!(field in patch)) continue;
        const v = patch[field];
        params[field] = kind === "json" ? JSON.stringify(v ?? null) : kind === "bool" ? Boolean(v) : (v == null ? null : String(v).slice(0, 2000));
        sets.push(`${field} = @${field}${kind === "json" ? "::jsonb" : ""}`);
    }
    const assign = [...sets, "heartbeat_at = now()", "updated_at = now()"].join(", ");
    await withTransaction(async (q) => {
        await q("INSERT INTO zalo_bot_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
        await q(`UPDATE zalo_bot_status SET ${assign} WHERE id = 1`, params);
    });
}
