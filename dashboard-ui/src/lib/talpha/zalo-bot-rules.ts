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

// ═══════════════════════════════════════════════════════════════════
// Kho của bot (migration 0003, 16/11/2026): phiên đăng nhập, nhóm từng nước, trạng thái — bot ghi qua
// POST /api/talpha/zalo/bot {store_ops} (ops/zalo-alerts/bot_store.js). Soát ở đây trước khi đụng kho.
// ═══════════════════════════════════════════════════════════════════

export type ZaloSession = Record<string, unknown> & { cookie: unknown; imei: string; userAgent: string; name?: string };
export type StoreGroup = { id: string; name: string; method: string | null; chosen_at: string | null };
export type StoreOp =
    | { type: "state_set"; section: string; item: string; value: unknown }
    | { type: "state_del"; section: string; item: string | null }
    | ({ type: "group_set"; market: string } & StoreGroup)
    | { type: "group_del"; market: string }
    | { type: "session_set"; value: ZaloSession }
    | { type: "session_del" };
export type StateRow = { section: string; item: string; value: unknown };
export type StoreImport = { session: ZaloSession | null; market_groups: Record<string, StoreGroup>; state_rows: StateRow[] };

export const MAX_STORE_OPS = 500;
const MAX_VALUE_CHARS = 1_000_000;        // một mục trạng thái (vd vanDonNhac của một nước) — chặn ghi bừa
const MAX_SESSION_CHARS = 64_000;
const SECTION_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MARKET_RE = /^[A-Z]{2,3}$/;
const GROUP_ID_RE = /^\d{1,30}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;

const jsonSize = (v: unknown) => { try { return JSON.stringify(v ?? null).length; } catch { return Infinity; } };

function checkSession(v: unknown): ZaloSession | string {
    if (!isRecord(v)) return "phiên không phải object";
    if (!v.cookie || typeof v.imei !== "string" || !v.imei || typeof v.userAgent !== "string" || !v.userAgent) {
        return "phiên thiếu cookie / imei / userAgent";
    }
    if (jsonSize(v) > MAX_SESSION_CHARS) return "phiên quá lớn";
    return v as ZaloSession;
}

function checkGroup(market: unknown, g: unknown): ({ market: string } & StoreGroup) | string {
    const m = String(market || "").trim().toUpperCase();
    if (!MARKET_RE.test(m)) return `mã nước lạ: ${m || "(trống)"}`;
    if (!isRecord(g)) return `nhóm ${m} không phải object`;
    const id = String(g.id ?? "").trim();
    if (!GROUP_ID_RE.test(id)) return `mã nhóm ${m} không hợp lệ`;
    const chosen = g.chosen_at == null ? null : String(g.chosen_at);
    return {
        market: m, id, name: String(g.name ?? "").slice(0, 200),
        method: g.method == null ? null : String(g.method).slice(0, 20),
        chosen_at: chosen && ISO_RE.test(chosen) ? chosen : null,
    };
}

function checkStateKey(section: unknown, item: unknown, allowNullItem: boolean): { section: string; item: string | null } | string {
    const s = String(section ?? "");
    if (!SECTION_RE.test(s)) return `mục trạng thái lạ: ${s.slice(0, 40) || "(trống)"}`;
    if (item === null && allowNullItem) return { section: s, item: null };
    if (typeof item !== "string" || item.length > 300) return `khoá con của ${s} không hợp lệ`;
    return { section: s, item };
}

/** Body {store_ops: […]} → thao tác ghi kho, hoặc lỗi đọc được (một thao tác hỏng là bỏ cả lượt — bot gửi lại). */
export function parseStoreOps(raw: unknown): StoreOp[] | { error: string } {
    if (!Array.isArray(raw)) return { error: "store_ops phải là mảng" };
    if (raw.length > MAX_STORE_OPS) return { error: `quá ${MAX_STORE_OPS} thao tác một lượt` };
    const out: StoreOp[] = [];
    for (const [i, op] of raw.entries()) {
        if (!isRecord(op)) return { error: `thao tác ${i}: không phải object` };
        const bad = (msg: string) => ({ error: `thao tác ${i} (${String(op.type)}): ${msg}` });
        switch (op.type) {
            case "state_set": {
                const k = checkStateKey(op.section, op.item, false);
                if (typeof k === "string") return bad(k);
                if (op.value === undefined) return bad("thiếu value");
                if (jsonSize(op.value) > MAX_VALUE_CHARS) return bad("giá trị quá lớn");
                out.push({ type: "state_set", section: k.section, item: k.item as string, value: op.value });
                break;
            }
            case "state_del": {
                const k = checkStateKey(op.section, op.item ?? null, true);
                if (typeof k === "string") return bad(k);
                out.push({ type: "state_del", section: k.section, item: k.item });
                break;
            }
            case "group_set": {
                const g = checkGroup(op.market, op);
                if (typeof g === "string") return bad(g);
                out.push({ type: "group_set", ...g });
                break;
            }
            case "group_del": {
                const m = String(op.market || "").trim().toUpperCase();
                if (!MARKET_RE.test(m)) return bad(`mã nước lạ: ${m || "(trống)"}`);
                out.push({ type: "group_del", market: m });
                break;
            }
            case "session_set": {
                const s = checkSession(op.value);
                if (typeof s === "string") return bad(s);
                out.push({ type: "session_set", value: s });
                break;
            }
            case "session_del":
                out.push({ type: "session_del" });
                break;
            default:
                return { error: `thao tác ${i}: loại lạ ${String(op.type)}` };
        }
    }
    return out;
}

/** Body {import: {session, market_groups, state_rows}} — chép file cũ của bot vào kho lần đầu (chỉ chỗ kho còn trống). */
export function parseStoreImport(raw: unknown): StoreImport | { error: string } {
    if (!isRecord(raw)) return { error: "import phải là object" };
    let session: ZaloSession | null = null;
    if (raw.session != null) {
        const s = checkSession(raw.session);
        if (typeof s === "string") return { error: s };
        session = s;
    }
    const market_groups: Record<string, StoreGroup> = {};
    for (const [m, g] of Object.entries(isRecord(raw.market_groups) ? raw.market_groups : {})) {
        const checked = checkGroup(m, g);
        if (typeof checked === "string") return { error: checked };
        const { market, ...rest } = checked;
        market_groups[market] = rest;
    }
    const rows = Array.isArray(raw.state_rows) ? raw.state_rows : [];
    if (rows.length > 20_000) return { error: "quá nhiều dòng trạng thái" };
    const state_rows: StateRow[] = [];
    for (const r of rows) {
        if (!isRecord(r)) return { error: "dòng trạng thái không phải object" };
        const k = checkStateKey(r.section, r.item, false);
        if (typeof k === "string") return { error: k };
        if (r.value === undefined || jsonSize(r.value) > MAX_VALUE_CHARS) return { error: `giá trị ${k.section} hỏng hoặc quá lớn` };
        state_rows.push({ section: k.section, item: k.item as string, value: r.value });
    }
    return { session, market_groups, state_rows };
}
