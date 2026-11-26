// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — đồng bộ sản phẩm POS → Knowledge Base (mục kind=product, source=pos_sync, dữ liệu CHÍNH THỨC).
// Chạy tay (nút ở trang Knowledge Base) hoặc theo lịch worker (`kb_sync_hours`). CHỈ ĐỌC POS.
//
// An toàn dữ liệu: upsert theo source_ref; mục không còn trên POS chỉ TẮT (disabled_reason = 'not_in_pos'), không xoá —
// và chỉ tắt khi lượt đọc shop đó trọn vẹn + đọc được ≥ 70 % số mục đang bật (đọc hụt thì không tắt gì). Admin tắt tay
// (disabled_reason khác) thì đồng bộ không bật lại. Mỗi mục đổi nội dung ghi một dòng lịch sử 'sync'.
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";
import { getCredential } from "@/lib/talpha/credentials";
import { DISABLED_MARKETS, RULES, SHOP_POS, posMoneyDivisor } from "@/lib/talpha/rules";
import { groupPosProducts, productToKb } from "./kb-pos";

const PAGE_SIZE = 100;
const MAX_PAGES = 60;

export type KbSyncShopResult = { shop: string; market: string; fetched: number; inserted: number; updated: number; disabled: number; error: string | null };

let running: Promise<KbSyncShopResult[]> | null = null;

/** Có shop POS đang bán, có key, mà kiến thức CHƯA có sản phẩm nào của shop đó (shop vừa thêm) → worker đồng bộ ngay. */
export async function hasUnsyncedShop(): Promise<boolean> {
    const rows = await query<{ shop: string }>(`SELECT DISTINCT split_part(source_ref, ':', 2) AS shop FROM ai_kb_entries
        WHERE source = 'pos_sync' AND source_ref IS NOT NULL`);
    const synced = new Set(rows.map((r) => r.shop));
    const markets = RULES.markets as Record<string, { status?: string }>;
    return SHOP_POS.some((s) => !DISABLED_MARKETS.has(s.name) && (markets[s.name]?.status || "active") === "active"
        && !!getCredential(s.bien_key) && !synced.has(s.shop_id));
}

/** Đang chạy thì trả lượt đang chạy (không chạy chồng). */
export function syncPosKnowledge(actor: string): Promise<KbSyncShopResult[]> {
    if (!running) running = doSync(actor).finally(() => { running = null; });
    return running;
}
export const kbSyncRunning = () => running !== null;

async function fetchShop(apiUrl: string, shopId: string, key: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const qs = new URLSearchParams({ api_key: key, page_number: String(page), page_size: String(PAGE_SIZE) });
        const r = await fetch(`${apiUrl}/shops/${encodeURIComponent(shopId)}/products/variations?${qs}`,
            { cache: "no-store", signal: AbortSignal.timeout(30_000) });
        const j = await r.json().catch(() => null) as { data?: Record<string, unknown>[]; total_pages?: number; success?: boolean; message?: string } | null;
        if (!r.ok || !j || j.success === false) throw new Error(`POS từ chối trang ${page}: ${j?.message || `HTTP ${r.status}`}`);
        const data = j.data || [];
        out.push(...data);
        if (!data.length || page >= Number(j.total_pages || 1)) break;
        await new Promise((res) => setTimeout(res, 300));
    }
    return out;
}

async function doSync(actor: string): Promise<KbSyncShopResult[]> {
    const markets = RULES.markets as Record<string, { currency?: string; status?: string }>;
    const results: KbSyncShopResult[] = [];
    for (const s of SHOP_POS) {
        if (DISABLED_MARKETS.has(s.name) || (markets[s.name]?.status || "active") !== "active") continue;
        const key = getCredential(s.bien_key);
        const res: KbSyncShopResult = { shop: s.shop_id, market: s.label, fetched: 0, inserted: 0, updated: 0, disabled: 0, error: null };
        results.push(res);
        if (!key) { res.error = `chưa có key POS (${s.bien_key})`; continue; }
        try {
            const items = await fetchShop(s.api_url, s.shop_id, key);
            const products = groupPosProducts(items as Record<string, any>[], posMoneyDivisor(s.label));
            res.fetched = products.length;
            const existing = await query<{ id: number; source_ref: string; hash: string | null; enabled: boolean; disabled_reason: string | null }>(
                `SELECT id, source_ref, metadata->>'hash' AS hash, enabled, disabled_reason FROM ai_kb_entries
                 WHERE source_ref LIKE @prefix AND deleted_at IS NULL`, { prefix: `pos:${s.shop_id}:%` });
            const byRef = new Map(existing.map((e) => [e.source_ref, e]));
            const seen = new Set<string>();
            for (const p of products) {
                const k = productToKb(p, { shopId: s.shop_id, market: s.label, currency: markets[s.name]?.currency || "" });
                seen.add(k.sourceRef);
                const cur = byRef.get(k.sourceRef);
                const metadata = JSON.stringify({ ...k.metadata, hash: k.hash });
                if (cur && cur.hash === k.hash && !(cur.disabled_reason === "not_in_pos")) {
                    await query(`UPDATE ai_kb_entries SET synced_at = now(), metadata = @metadata::jsonb WHERE id = @id`, { id: cur.id, metadata });
                    continue;
                }
                const [row] = await query<{ id: number; inserted: boolean }>(
                    `INSERT INTO ai_kb_entries (scope, market, kind, source, source_ref, is_official, title, content, keywords, metadata,
                         synced_at, created_by, updated_by)
                     VALUES ('market', @market, 'product', 'pos_sync', @ref, true, @title, @content, @keywords, @metadata::jsonb, now(), @actor, @actor)
                     ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
                         keywords = EXCLUDED.keywords, metadata = EXCLUDED.metadata, synced_at = now(), updated_at = now(), updated_by = EXCLUDED.updated_by,
                         enabled = CASE WHEN ai_kb_entries.disabled_reason = 'not_in_pos' THEN true ELSE ai_kb_entries.enabled END,
                         disabled_reason = CASE WHEN ai_kb_entries.disabled_reason = 'not_in_pos' THEN NULL ELSE ai_kb_entries.disabled_reason END
                     RETURNING id, (xmax = 0) AS inserted`,
                    { market: s.label, ref: k.sourceRef, title: k.title, content: k.content, keywords: k.keywords, metadata, actor });
                if (row.inserted) res.inserted++; else res.updated++;
                await query(`INSERT INTO ai_kb_revisions (entry_id, action, after, actor) VALUES (@id, 'sync', @after::jsonb, @actor)`,
                    { id: row.id, after: JSON.stringify({ title: k.title, content: k.content, variants: k.metadata.variants }), actor });
            }
            const enabledBefore = existing.filter((e) => e.enabled).length;
            const missing = existing.filter((e) => e.enabled && !seen.has(e.source_ref));
            if (missing.length && products.length >= 0.7 * enabledBefore) {
                for (const m of missing) {
                    await query(`UPDATE ai_kb_entries SET enabled = false, disabled_reason = 'not_in_pos', updated_at = now(), updated_by = @actor
                        WHERE id = @id`, { id: m.id, actor });
                    await query(`INSERT INTO ai_kb_revisions (entry_id, action, actor) VALUES (@id, 'disable', @actor)`, { id: m.id, actor });
                    res.disabled++;
                }
            } else if (missing.length) {
                res.error = `đọc được ${products.length} SP < 70% của ${enabledBefore} mục đang bật — không tắt mục nào (nghi đọc hụt)`;
            }
        } catch (e) {
            res.error = e instanceof Error ? e.message : String(e);
        }
    }
    console.log(`[ai-chatbot] đồng bộ KB từ POS: ${results.map((r) => `${r.market} ${r.fetched} SP (+${r.inserted} ~${r.updated} -${r.disabled})${r.error ? ` lỗi: ${r.error}` : ""}`).join(" · ")}`);
    return results;
}
