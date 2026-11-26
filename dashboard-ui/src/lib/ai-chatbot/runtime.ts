// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — ráp các cổng THẬT cho Router ở máy chủ: Postgres (lib/db.ts), Pancake (token page trong Khoá kết nối),
// AI provider (khoá trong Khoá kết nối, trần chi phí, ghi từng lượt gọi), Telegram. Chỉ chạy trong tiến trình Next
// (worker + route) — không import vào trình duyệt.
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";
import { getCredential, saveCredential } from "@/lib/talpha/credentials";
import { RULES } from "@/lib/talpha/rules";
import { PANCAKE_TOKEN_VARS } from "@/lib/talpha/pancake";
import { costUsd, normalizeSettings, type AiSettings, type ProviderName } from "./settings";
import { createPgStore, type PgStore } from "./store-pg";
import { createPancakeClient, readExistingPageTokens, type PancakeClient } from "./pancake-client";
import { callModel, PROVIDER_KEY_VARS, RateLimiter } from "./providers";
import { formatEscalation, sendTelegram } from "./telegram";
import { AiError, type AiChatRequest, type AiChatResult, type AiPort, type NotifierPort } from "./types";
import { vnDayStart, vnMonthStart, type RouterDeps } from "./router";

/** Khối gốc ở talpha_rules.json → ai_chatbot. */
export function baseSettings(): unknown {
    return (RULES as unknown as { ai_chatbot?: unknown }).ai_chatbot || {};
}

const SETTINGS_TTL = 10_000;
let settingsCache: { at: number; settings: AiSettings; override: Record<string, unknown> } | null = null;

/** Đọc phần sửa trên trang (bảng ai_bot_settings) + gốc → cài đặt. Bảng chưa có (chưa migrate) → gốc (an toàn). */
export async function loadSettings(force = false): Promise<AiSettings> {
    if (!force && settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL) return settingsCache.settings;
    let override: Record<string, unknown> = {};
    try {
        const [r] = await query<{ settings: Record<string, unknown> }>("SELECT settings FROM ai_bot_settings WHERE id = 1");
        override = r?.settings || {};
    } catch (e) {
        console.error("[ai-chatbot] không đọc được ai_bot_settings (chưa migrate 0009?) — dùng cài đặt gốc:", (e as Error).message);
    }
    const { settings } = normalizeSettings(baseSettings(), override);
    settingsCache = { at: Date.now(), settings, override };
    return settings;
}
export function cachedSettings(): AiSettings {
    return settingsCache?.settings || normalizeSettings(baseSettings(), {}).settings;
}
export function invalidateSettings() { settingsCache = null; }

/** Tên khoá token page trong api_credentials (mã hoá). */
export function pageTokenVar(pageId: string): string {
    return `AI_PANCAKE_PAGE_TOKEN_${String(pageId).replace(/[^\w]/g, "_")}`;
}
export const TELEGRAM_TOKEN_VAR = "AI_TELEGRAM_BOT_TOKEN";
export const WEBHOOK_SECRET_VAR = "AI_PANCAKE_WEBHOOK_SECRET";

export function providerKey(p: ProviderName): string {
    for (const v of PROVIDER_KEY_VARS[p]) {
        const k = getCredential(v);
        if (k) return k;
    }
    return "";
}

// Token tài khoản đọc được page nào (pancake_pages.token_var) — đọc dự phòng ở chế độ shadow.
let tokenVarCache: { at: number; map: Map<string, string> } | null = null;
async function accountTokenVar(pageId: string): Promise<string | null> {
    if (!tokenVarCache || Date.now() - tokenVarCache.at > 60_000) {
        const rows = await query<{ page_id: string; token_var: string | null }>("SELECT page_id, token_var FROM pancake_pages").catch(() => []);
        tokenVarCache = { at: Date.now(), map: new Map(rows.filter((r) => r.token_var).map((r) => [r.page_id, String(r.token_var)])) };
    }
    const v = tokenVarCache.map.get(pageId);
    return v && PANCAKE_TOKEN_VARS.includes(v) ? v : null;
}

type Runtime = { pg: PgStore; pancake: PancakeClient; limiters: Map<string, RateLimiter> };
const SLOT = Symbol.for("talpha.aiChatbotRuntime");
type Holder = { [SLOT]?: Runtime };

/** Một bộ cổng cho cả tiến trình (giữ trên globalThis — dev hot-reload không đẻ thêm bản). */
export function runtime(): Runtime {
    const g = globalThis as Holder;
    if (g[SLOT]) return g[SLOT]!;
    const pg = createPgStore(query, {
        hasPageToken: (pageId) => !!getCredential(pageTokenVar(pageId)),
        hasAccountToken: (v) => !!v && PANCAKE_TOKEN_VARS.includes(v) && !!getCredential(v),
        // Luật page TỰ ĐỘNG (page-policy.ts) theo cài đặt hiện tại.
        policy: () => {
            const S = cachedSettings();
            return { pagesAuto: S.pages_auto, live: S.mode === "live", otherBotQuietMs: S.other_bot_quiet_hours * 3600_000,
                errorBackoffMs: S.page_error_backoff_minutes * 60_000 };
        },
    });
    const ownIdsStore = pg.store;
    const pancake = createPancakeClient({
        fetch: (u, i) => fetch(u, i),
        timeoutMs: 20_000,
        auth: async (pageId) => {
            const pageToken = getCredential(pageTokenVar(pageId)) || null;
            const v = pageToken ? null : await accountTokenVar(pageId);
            return { pageToken, accountToken: v ? getCredential(v) || null : null };
        },
        senderContext: async (pageId, conversationId) => ({
            ownSenderNames: cachedSettings().own_sender_names,
            ownMessageIds: await ownIdsStore.ownSentMessageIds(pageId, conversationId),
            ownTexts: await ownIdsStore.ownSentTexts(pageId, conversationId),
        }),
    });
    g[SLOT] = { pg, pancake, limiters: new Map() };
    return g[SLOT]!;
}

/**
 * AI port thật: chọn provider / model theo mục đích (classify → model nhẹ, generate → model chính), soát trần chi phí
 * TRƯỚC khi gọi, ghi mọi lượt gọi (cả lỗi) vào ai_bot_provider_calls.
 */
export function aiPort(settings: () => AiSettings, ctx: { pageId?: string | null; purposeOverride?: AiChatRequest["purpose"] } = {}): AiPort {
    const rt = runtime();
    const port: AiPort & { callWith(req: AiChatRequest, choice: { provider: ProviderName; model: string }): Promise<AiChatResult> } = {
        async chat(req: AiChatRequest): Promise<AiChatResult> {
            const S = settings();
            const primary = req.purpose === "classify" ? S.classifier : S.generator;
            try {
                return await port.callWith(req, primary);
            } catch (e) {
                // Model phân loại (nhẹ) quá tải / lỗi tạm (đo 26/11/2026: gemini-flash-lite-latest 503 "high demand") → thử
                // MỘT lần bằng model trả lời, khỏi rơi xuống bộ phân loại dự phòng rồi chuyển Sale oan.
                const fallback = S.generator;
                const transient = e instanceof AiError && e.retryable && e.code !== "budget";
                if (req.purpose !== "classify" || !transient || (fallback.provider === primary.provider && fallback.model === primary.model)) throw e;
                return await port.callWith(req, fallback);
            }
        },
        async callWith(req: AiChatRequest, choice: { provider: ProviderName; model: string }): Promise<AiChatResult> {
            const S = settings();
            const now = Date.now();
            const [day, month] = await Promise.all([rt.pg.store.costSince(vnDayStart(now)), rt.pg.store.costSince(vnMonthStart(now))]);
            if (day >= S.daily_cost_limit_usd || month >= S.monthly_cost_limit_usd) {
                throw new AiError("budget", `Đã chạm trần chi phí AI (hôm nay $${day.toFixed(4)}, tháng $${month.toFixed(4)})`, false);
            }
            let limiter = rt.limiters.get(choice.provider);
            if (!limiter) { limiter = new RateLimiter(S.provider_rpm); rt.limiters.set(choice.provider, limiter); }
            limiter.setRpm(S.provider_rpm);
            const purpose = ctx.purposeOverride || req.purpose;
            try {
                const r = await callModel({
                    provider: choice.provider, model: choice.model, apiKey: providerKey(choice.provider), pricing: S.pricing,
                    maxRetries: S.max_retries, timeoutMs: S.timeout_seconds * 1000, fetch: (u, i) => fetch(u, i), limiter,
                }, { system: req.system, messages: req.messages, json: req.json, temperature: req.temperature, maxTokens: req.maxTokens });
                await rt.pg.queue.recordProviderCall({
                    purpose, provider: r.provider, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
                    costUsd: r.costUsd, latencyMs: r.latencyMs, ok: true, pageId: ctx.pageId,
                }).catch((e) => console.error("[ai-chatbot] ghi provider_calls lỗi:", e));
                return r;
            } catch (e) {
                // Lượt lỗi mà hãng vẫn tính tiền (Gemini MAX_TOKENS…) → ghi đúng token + tiền cho trần chi phí.
                const u = e instanceof AiError && e.usage ? e.usage : { inputTokens: 0, outputTokens: 0 };
                await rt.pg.queue.recordProviderCall({
                    purpose, provider: choice.provider, model: choice.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
                    costUsd: costUsd(S.pricing, choice.provider, choice.model, u.inputTokens, u.outputTokens),
                    latencyMs: null, ok: false, error: e instanceof Error ? e.message : String(e), pageId: ctx.pageId,
                }).catch(() => {});
                throw e;
            }
        },
    };
    return port;
}

export function telegramNotifier(settings: () => AiSettings): NotifierPort {
    return {
        async notify(p) {
            const S = settings();
            const r = await sendTelegram((u, i) => fetch(u, i), getCredential(TELEGRAM_TOKEN_VAR), S.telegram.chat_id, formatEscalation(p));
            return { ok: r.ok, error: r.error };
        },
    };
}

// ─── Token page TỰ ĐỘNG ───────────────────────────────────────────────
let tokenSync: Promise<{ found: number; saved: number; errors: string[] }> | null = null;
let lastTokenSyncAt = 0;

/**
 * Đọc token page CÓ SẴN của mọi page bằng các token tài khoản Pancake (OFFICIAL: GET /pages?fields=activated{id,
 * settings{page_access_token}} — chỉ ĐỌC, KHÔNG sinh mới: sinh mới làm chết token đang dùng ở bot AI Sale cũ / tích hợp
 * khác). Lưu (mã hoá) khi page chưa có token hoặc token đã đổi. Page mới nối Pancake tự có token — không cấu hình tay.
 * Đang chạy thì trả lượt đang chạy; `minGapMs` = không chạy lại nếu vừa chạy.
 */
export function syncPageTokens(actor = "tự đồng bộ", minGapMs = 0): Promise<{ found: number; saved: number; errors: string[] }> {
    if (tokenSync) return tokenSync;
    if (minGapMs && Date.now() - lastTokenSyncAt < minGapMs) return Promise.resolve({ found: 0, saved: 0, errors: [] });
    lastTokenSyncAt = Date.now();
    tokenSync = (async () => {
        const pages = new Set((await query<{ page_id: string }>("SELECT page_id FROM pancake_pages")).map((r) => r.page_id));
        let found = 0, saved = 0;
        const errors: string[] = [];
        for (const v of PANCAKE_TOKEN_VARS) {
            const acct = getCredential(v);
            if (!acct) continue;
            try {
                const m = await readExistingPageTokens((u, i) => fetch(u, i), acct);
                for (const [pid, tok] of m) {
                    if (!pages.has(pid)) continue;
                    found++;
                    if (getCredential(pageTokenVar(pid)) === tok) continue;
                    await saveCredential(pageTokenVar(pid), tok, `tự đọc từ tài khoản Pancake (${v})`, actor);
                    saved++;
                }
            } catch (e) {
                errors.push(`${v}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        if (saved || errors.length) console.log(`[ai-chatbot] token page: thấy ${found}, lưu mới ${saved}${errors.length ? ` · lỗi: ${errors.join("; ")}` : ""}`);
        return { found, saved, errors };
    })().finally(() => { tokenSync = null; });
    return tokenSync;
}

/** Báo người vận hành qua Telegram (page lỗi, token hết hạn…) — không phải báo Sale theo hội thoại. Lỗi Telegram bỏ qua. */
export async function sendOpsAlert(text: string): Promise<boolean> {
    const S = cachedSettings();
    const token = getCredential(TELEGRAM_TOKEN_VAR);
    if (!S.telegram.enabled || !S.telegram.chat_id || !token) return false;
    const r = await sendTelegram((u, i) => fetch(u, i), token, S.telegram.chat_id, text).catch(() => ({ ok: false }));
    return r.ok;
}

/** Link trong tin Telegram: nhật ký AI của hội thoại trên dashboard + (tuỳ chọn) link Pancake theo mẫu. */
export function conversationLinks(S: AiSettings, pageId: string, conversationId: string) {
    const host = (process.env.DASHBOARD_HTTPS_HOST || "").trim();
    const dashboardUrl = host ? `https://${host}/talpha/ai-logs?conversation_id=${encodeURIComponent(conversationId)}` : null;
    const pancakeUrl = S.pancake_url_template
        ? S.pancake_url_template.replace("{page_id}", encodeURIComponent(pageId)).replace("{conversation_id}", encodeURIComponent(conversationId))
        : null;
    return { dashboardUrl, pancakeUrl };
}

/** Bộ phụ thuộc đầy đủ cho Router (worker dùng) — một bộ cho mỗi job (ghi page vào bảng chi phí). */
export function routerDeps(pageId: string | null = null): RouterDeps {
    const rt = runtime();
    const settings = () => cachedSettings();
    return {
        store: rt.pg.store,
        chat: rt.pancake,
        ai: aiPort(settings, { pageId }),
        notifier: telegramNotifier(settings),
        now: () => Date.now(),
        settings,
        refreshSettings: () => loadSettings(true),
        links: (p, c) => conversationLinks(cachedSettings(), p, c),
        log: (m) => console.log(m),
    };
}
