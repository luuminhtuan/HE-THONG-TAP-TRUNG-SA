// ═══════════════════════════════════════════════════════════════════
// Bot Zalo điều khiển từ trang (/admin → Khoá kết nối → Zalo, 16/11/2026) — phần THUẦN: soát yêu cầu bấm trên
// trang, bot còn chạy không. Phần đụng kho: zalo-bot.ts. Bot nhặt yêu cầu ở ops/zalo-alerts/bot_control.js.
// ═══════════════════════════════════════════════════════════════════

export const ZALO_ACTIONS = ["pair", "refresh_groups", "set_group", "send_test", "unpair"] as const;
export type ZaloAction = (typeof ZALO_ACTIONS)[number];
export type ZaloRequestInput = { action: ZaloAction; payload: Record<string, string> };

/** Bot gửi nhịp tim mỗi 30 giây — quá chừng này không thấy là coi như bot không chạy. */
export const BOT_OFFLINE_AFTER_MS = 90_000;

/** Yêu cầu "running" lâu hơn thế là bot đã dừng giữa chừng (ghép nick tối đa 5 mã QR × ~100 giây). */
export const STALE_RUNNING_MS = 15 * 60_000;

export function isBotOnline(heartbeatAt: string | null | undefined, now: number = Date.now()): boolean {
    if (!heartbeatAt) return false;
    const t = Date.parse(heartbeatAt);
    return Number.isFinite(t) && now - t <= BOT_OFFLINE_AFTER_MS;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Body POST /api/talpha/zalo → yêu cầu hợp lệ, hoặc lỗi đọc được. `markets`: mã nước bot phục vụ. */
export function parseZaloRequest(body: unknown, markets: string[]): ZaloRequestInput | { error: string } {
    if (!isRecord(body)) return { error: "Thiếu nội dung yêu cầu" };
    const action = String(body.action || "") as ZaloAction;
    if (!ZALO_ACTIONS.includes(action)) return { error: `Việc lạ: ${String(body.action || "(trống)")}` };
    const raw = isRecord(body.payload) ? body.payload : {};
    const market = String(raw.market || "").trim().toUpperCase();
    const known = markets.map((m) => m.toUpperCase());

    if (action === "set_group" || action === "send_test") {
        if (!known.includes(market)) return { error: `Nước lạ: ${market || "(trống)"} — bot phục vụ ${known.join(", ") || "(chưa có nước nào)"}` };
    }
    if (action === "set_group") {
        // group_id rỗng = bỏ nhóm của nước đó (nước đó thôi nhận tin).
        const groupId = String(raw.group_id || "").trim();
        if (groupId && !/^\d{1,30}$/.test(groupId)) return { error: "Mã nhóm Zalo không hợp lệ" };
        return { action, payload: { market, group_id: groupId } };
    }
    if (action === "send_test") return { action, payload: { market } };
    return { action, payload: {} };
}
