// ═══════════════════════════════════════════════════════════════════
// Kho của bot Zalo trong Postgres (migration 0003, 16/11/2026) — thay ba loại file trên máy chạy bot:
//   zalo_session        phiên đăng nhập nick phụ, MÃ HOÁ pgcrypto bằng TALPHA_ENCRYPTION_KEY (như api_credentials)
//   zalo_market_groups  nhóm nhận tin từng nước
//   zalo_bot_state      trạng thái bot, mỗi dòng một mục (section, item)
// Chỉ bot gọi tới đây, qua /api/talpha/zalo/bot (chìa nội bộ) — ops/zalo-alerts/bot_store.js. Soát dữ liệu ở
// zalo-bot-rules.ts (parseStoreOps, parseStoreImport). Phiên giải mã trả cho bot — không ghi log.
// ═══════════════════════════════════════════════════════════════════
import { query, withTransaction } from "@/lib/db";
import { ENCRYPTION_KEY_VAR, getEncryptionKey } from "./startup-data";
import type { StateRow, StoreGroup, StoreImport, StoreOp, ZaloSession } from "./zalo-bot-rules";

export type ZaloStore = {
    state_rows: StateRow[];
    market_groups: Record<string, StoreGroup>;
    session: ZaloSession | null;
    /** Có dòng phiên mà chìa hiện tại không mở được (chìa đã đổi) — bot coi như chưa ghép. */
    session_unreadable: boolean;
};

type Q = typeof query;

function requireKey(): string {
    const key = getEncryptionKey();
    if (!key) throw new Error(`Chưa đặt ${ENCRYPTION_KEY_VAR} trên máy chủ — không mã hoá được phiên Zalo`);
    return key;
}

const sessionName = (s: ZaloSession) => (typeof s.name === "string" && s.name ? s.name.slice(0, 200) : null);

async function writeSession(q: Q, s: ZaloSession, onConflict: "update" | "skip"): Promise<number> {
    const rows = await q<{ id: number }>(
        `INSERT INTO zalo_session (id, encrypted_value, account_name, saved_at)
         VALUES (1, public.pgp_sym_encrypt(@value, @key), @name, now())
         ON CONFLICT (id) DO ${onConflict === "update"
            ? "UPDATE SET encrypted_value = EXCLUDED.encrypted_value, account_name = EXCLUDED.account_name, saved_at = now()"
            : "NOTHING"}
         RETURNING id`,
        { value: JSON.stringify(s), key: requireKey(), name: sessionName(s) });
    return rows.length;
}

async function writeGroup(q: Q, market: string, g: StoreGroup, onConflict: "update" | "skip"): Promise<number> {
    const rows = await q<{ market: string }>(
        `INSERT INTO zalo_market_groups (market, group_id, group_name, method, chosen_at)
         VALUES (@market, @id, @name, @method, COALESCE(@chosenAt::timestamptz, now()))
         ON CONFLICT (market) DO ${onConflict === "update"
            ? "UPDATE SET group_id = EXCLUDED.group_id, group_name = EXCLUDED.group_name, method = EXCLUDED.method, chosen_at = EXCLUDED.chosen_at"
            : "NOTHING"}
         RETURNING market`,
        { market, id: g.id, name: g.name, method: g.method, chosenAt: g.chosen_at });
    return rows.length;
}

async function writeStateItem(q: Q, r: StateRow, onConflict: "update" | "skip"): Promise<number> {
    const rows = await q<{ section: string }>(
        `INSERT INTO zalo_bot_state (section, item, value, updated_at) VALUES (@section, @item, @value::jsonb, now())
         ON CONFLICT (section, item) DO ${onConflict === "update" ? "UPDATE SET value = EXCLUDED.value, updated_at = now()" : "NOTHING"}
         RETURNING section`,
        { section: r.section, item: r.item, value: JSON.stringify(r.value) });
    return rows.length;
}

/** Cả kho cho bot nạp lúc khởi động / đọc lại mỗi vòng rà. */
export async function readZaloStore(): Promise<ZaloStore> {
    const state_rows = await query<StateRow>("SELECT section, item, value FROM zalo_bot_state ORDER BY section, item");
    const groupRows = await query<{ market: string; group_id: string; group_name: string; method: string | null; chosen_at: string | null }>(
        "SELECT market, group_id, group_name, method, chosen_at FROM zalo_market_groups ORDER BY market");
    const market_groups = Object.fromEntries(groupRows.map((g) => [g.market,
        { id: g.group_id, name: g.group_name, method: g.method, chosen_at: g.chosen_at ? new Date(g.chosen_at).toISOString() : null }]));
    const key = getEncryptionKey();
    const [row] = await query<{ value: string | null }>(
        "SELECT safe_decrypt(encrypted_value, @key) AS value FROM zalo_session WHERE id = 1", { key });
    let session: ZaloSession | null = null;
    if (row?.value) {
        try { session = JSON.parse(row.value) as ZaloSession; } catch { session = null; }
    }
    if (row && !session) console.error(`zalo-bot-store: phiên Zalo không giải mã được bằng ${ENCRYPTION_KEY_VAR} hiện tại — cần ghép lại nick`);
    return { state_rows, market_groups, session, session_unreadable: !!row && !session };
}

/** Ghi một lượt thao tác của bot, theo đúng thứ tự, trong MỘT transaction. */
export async function applyZaloStoreOps(ops: StoreOp[]): Promise<void> {
    await withTransaction(async (q) => {
        for (const op of ops) {
            switch (op.type) {
                case "state_set": await writeStateItem(q, op, "update"); break;
                case "state_del":
                    if (op.item === null) await q("DELETE FROM zalo_bot_state WHERE section = @section", { section: op.section });
                    else await q("DELETE FROM zalo_bot_state WHERE section = @section AND item = @item", { section: op.section, item: op.item });
                    break;
                case "group_set": await writeGroup(q, op.market, op, "update"); break;
                case "group_del": await q("DELETE FROM zalo_market_groups WHERE market = @market", { market: op.market }); break;
                case "session_set": await writeSession(q, op.value, "update"); break;
                case "session_del": await q("DELETE FROM zalo_session WHERE id = 1"); break;
            }
        }
    });
}

/** Chép file cũ của bot vào kho — CHỈ chỗ kho còn trống (không đè thứ đã có). Trả số dòng đã thêm. */
export async function importZaloStore(data: StoreImport): Promise<{ session: boolean; groups: number; state_rows: number }> {
    return withTransaction(async (q) => {
        const session = data.session ? (await writeSession(q, data.session, "skip")) > 0 : false;
        let groups = 0, stateRows = 0;
        for (const [market, g] of Object.entries(data.market_groups)) groups += await writeGroup(q, market, g, "skip");
        for (const r of data.state_rows) stateRows += await writeStateItem(q, r, "skip");
        return { session, groups, state_rows: stateRows };
    });
}
