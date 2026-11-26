// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — adapter Pancake chat. CHỈ Public API chính thức (developer.pancake.biz/openapi/openapi.yaml) với token PAGE
// do admin dán / đọc token có sẵn — không sinh token mới (sinh mới VÔ HIỆU token cũ: bot AI Sale + tích hợp khác chết).
// Không dùng API nội bộ giao diện pancake.vn. Đọc dự phòng bằng token TÀI KHOẢN (đường tab Tin nhắn đang chạy) chỉ để
// chạy shadow ở page chưa có token page.
//
// Giới hạn chính thức: 5 lượt / giây / page → giãn ≥ 250 ms / page. HTTP 200 + success:false = lỗi (Pancake hay làm vậy).
// `fetch` tiêm vào được (test).
// ═══════════════════════════════════════════════════════════════════
import type { ChatPort, ConversationSnapshot, SendResult } from "./types";
import { lastSentByPage, normalizeConversation, normalizeMessages, pancakeCustomerId, type SenderContext } from "./pancake-parse";
import type { FetchLike } from "./providers";

export const PANCAKE_PUBLIC_V1 = "https://pages.fm/api/public_api/v1";
export const PANCAKE_PUBLIC_V2 = "https://pages.fm/api/public_api/v2";
export const PANCAKE_ACCOUNT_V1 = "https://pages.fm/api/v1";
/** Tìm một hội thoại trong danh sách: tối đa chừng này trang (60 / trang). */
const ROW_MAX_PAGES = 10;

export class PancakeError extends Error {
    code: string | null;
    status: number | null;
    retryable: boolean;
    ambiguous: boolean;
    constructor(message: string, o: { code?: string | null; status?: number | null; retryable?: boolean; ambiguous?: boolean } = {}) {
        super(message);
        this.name = "PancakeError";
        this.code = o.code ?? null;
        this.status = o.status ?? null;
        this.retryable = !!o.retryable;
        this.ambiguous = !!o.ambiguous;
    }
}

export type PancakeAuth = { pageToken: string | null; accountToken: string | null };

export type PancakeClientOptions = {
    fetch: FetchLike;
    timeoutMs: number;
    auth: (pageId: string) => Promise<PancakeAuth>;
    /** Tên gửi + id tin của module (để nhận ra tin của chính mình). */
    senderContext: (pageId: string, conversationId: string) => Promise<Omit<SenderContext, "pageId">>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
};

type Raw = Record<string, any>;

export function createPancakeClient(o: PancakeClientOptions) {
    const sleep = o.sleep || ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const now = o.now || Date.now;
    const lastCall = new Map<string, number>();
    const listCache = new Map<string, { at: number; rows: Raw[] }>();
    const tagCache = new Map<string, { at: number; tags: { id: string; text: string }[] }>();

    async function pace(pageId: string) {
        const wait = (lastCall.get(pageId) || 0) + 250 - now();
        if (wait > 0) await sleep(wait);
        lastCall.set(pageId, now());
    }

    async function call(pageId: string, method: "GET" | "POST", url: string, query: Record<string, string>, body?: unknown, attempt = 0): Promise<Raw> {
        await pace(pageId);
        const qs = new URLSearchParams(query).toString();
        let res: Response;
        try {
            res = await o.fetch(`${url}?${qs}`, {
                method,
                headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(o.timeoutMs),
                cache: "no-store",
            } as RequestInit);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // POST hết giờ: KHÔNG biết Pancake đã gửi chưa → mơ hồ, không thử lại (tránh gửi trùng).
            throw new PancakeError(`Pancake không trả lời: ${msg}`, { retryable: method === "GET", ambiguous: method === "POST" });
        }
        const raw = await res.text().catch(() => "");
        let j: Raw | null = null;
        try { j = raw ? JSON.parse(raw) : null; } catch { j = null; }
        if (res.status === 429 && method === "GET" && attempt < 2) {
            await sleep(1000 * (attempt + 1));
            return call(pageId, method, url, query, body, attempt + 1);
        }
        if (!res.ok || !j || j.success === false) {
            const code = j?.error_code !== undefined ? String(j.error_code) : j?.message_code ? String(j.message_code) : null;
            const msg = j?.message || j?.error || `HTTP ${res.status}`;
            throw new PancakeError(`Pancake từ chối: ${String(msg).slice(0, 200)}${code ? ` (mã ${code})` : ""}`, {
                code, status: res.status, retryable: res.status === 429 || res.status >= 500,
            });
        }
        return j;
    }

    /**
     * Hội thoại cập nhật trong khoảng [since, until] (giây), mới → cũ. Public API v2 trả tối đa 60 / lượt — lật trang bằng
     * `last_conversation_id` (OFFICIAL) tới `maxPages` trang hoặc hết.
     */
    async function listRecentConversations(pageId: string, sinceSec: number, untilSec: number, maxPages = 1,
        stopWhen?: (rows: Raw[]) => boolean): Promise<Raw[]> {
        const a = await o.auth(pageId);
        if (a.pageToken) {
            const out: Raw[] = [];
            let last: string | null = null;
            for (let i = 0; i < Math.max(1, maxPages); i++) {
                const j = await call(pageId, "GET", `${PANCAKE_PUBLIC_V2}/pages/${encodeURIComponent(pageId)}/conversations`, {
                    page_access_token: a.pageToken, since: String(sinceSec), until: String(untilSec), order_by: "updated_at",
                    ...(last ? { last_conversation_id: last } : {}),
                });
                const rows = (j.conversations || []) as Raw[];
                out.push(...rows);
                if (rows.length < 60 || (stopWhen && stopWhen(rows))) break;
                const next = rows[rows.length - 1]?.id ? String(rows[rows.length - 1].id) : null;
                if (!next || next === last) break;
                last = next;
            }
            return out;
        }
        if (a.accountToken) {
            const j = await call(pageId, "GET", `${PANCAKE_ACCOUNT_V1}/pages/${encodeURIComponent(pageId)}/conversations`, {
                access_token: a.accountToken, current_count: "0", type: "INBOX",
            });
            const rows = (j.conversations || []) as Raw[];
            return rows.filter((c) => {
                const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(c.updated_at)) ? String(c.updated_at) : `${c.updated_at}Z`);
                return !Number.isNaN(t) && t / 1000 >= sinceSec;
            });
        }
        throw new PancakeError("Page chưa có token (token page hoặc token tài khoản Pancake)", { code: "no_token" });
    }

    /** Bản ghi hội thoại (tag, người phụ trách) — tìm trong danh sách cập nhật từ `sinceMs`, lật trang tới khi thấy. */
    async function conversationRow(pageId: string, conversationId: string, fresh: boolean, sinceMs?: number): Promise<Raw | null> {
        const want = String(conversationId);
        const c = listCache.get(pageId);
        const cached = c && !fresh && now() - c.at < 15_000 ? c.rows.find((r) => String(r.id) === want) : null;
        if (cached) return cached;
        const until = Math.floor(now() / 1000) + 60;
        const since = Math.floor((sinceMs ?? now() - 2 * 86400_000) / 1000);
        const rows = await listRecentConversations(pageId, since, until, ROW_MAX_PAGES, (batch) => batch.some((r) => String(r.id) === want));
        listCache.set(pageId, { at: now(), rows });
        return rows.find((r) => String(r.id) === want) || null;
    }

    async function listTags(pageId: string): Promise<{ id: string; text: string }[]> {
        const c = tagCache.get(pageId);
        if (c && now() - c.at < 10 * 60_000) return c.tags;
        const a = await o.auth(pageId);
        if (!a.pageToken) throw new PancakeError("Page chưa có token page — không đọc được tag", { code: "no_page_token" });
        const j = await call(pageId, "GET", `${PANCAKE_PUBLIC_V1}/pages/${encodeURIComponent(pageId)}/tags`, { page_access_token: a.pageToken });
        const tags = ((j.tags || []) as Raw[]).filter((t) => t && t.id !== undefined).map((t) => ({ id: String(t.id), text: String(t.text || "") }));
        tagCache.set(pageId, { at: now(), tags });
        return tags;
    }

    const port: ChatPort & {
        listRecentConversations: typeof listRecentConversations;
        listTags: typeof listTags;
    } = {
        listRecentConversations,
        listTags,

        async fetchConversation(pageId, conversationId, opts): Promise<ConversationSnapshot> {
            const a = await o.auth(pageId);
            const row = await conversationRow(pageId, conversationId, !!opts?.fresh, opts?.sinceMs).catch((e) => {
                if (a.pageToken) throw e;
                return null;
            });
            let msgs: Raw;
            if (a.pageToken) {
                msgs = await call(pageId, "GET", `${PANCAKE_PUBLIC_V1}/pages/${encodeURIComponent(pageId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
                    { page_access_token: a.pageToken });
            } else if (a.accountToken) {
                const cid = row ? pancakeCustomerId(row) : null;
                if (!cid) throw new PancakeError("Không tìm được mã khách Pancake của hội thoại (đọc bằng token tài khoản cần customer_id)", { code: "no_customer_id" });
                msgs = await call(pageId, "GET", `${PANCAKE_ACCOUNT_V1}/pages/${encodeURIComponent(pageId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
                    { access_token: a.accountToken, customer_id: cid });
            } else {
                throw new PancakeError("Page chưa có token", { code: "no_token" });
            }
            const ctx = { pageId, ...(await o.senderContext(pageId, conversationId)) };
            const list = (msgs.messages || []) as Raw[];
            let tagNames = new Map<string, string>();
            if (row && Array.isArray(row.tags) && row.tags.some((t: unknown) => typeof t === "number" || typeof t === "string")) {
                // Tag dạng id: PHẢI tra được tên (không tra được = không biết hội thoại có tag tắt AI không → ném lỗi, router
                // không gửi), không lặng lẽ coi như không có tag.
                if (!a.pageToken) throw new PancakeError("Không tra được tên tag (chưa có token page)", { code: "tag_names", retryable: true });
                const tags = await listTags(pageId);
                tagNames = new Map(tags.map((t): [string, string] => [t.id, t.text]));
            }
            // Không tìm thấy hội thoại trong danh sách = KHÔNG biết tag / người phụ trách → conversation null (router không gửi).
            const conversation = row ? normalizeConversation(row, pageId, tagNames)
                : msgs.conversation && typeof msgs.conversation === "object" ? normalizeConversation(msgs.conversation as Raw, pageId) : null;
            return {
                conversation,
                messages: normalizeMessages(list, ctx),
                // Pancake trả ~25–30 tin mới nhất mỗi lượt: ít hơn 25 = đã tới tin đầu tiên.
                complete: list.length < 25,
            };
        },

        async sendText(pageId, conversationId, text): Promise<SendResult> {
            const a = await o.auth(pageId);
            if (!a.pageToken) return { ok: false, error: "Page chưa có token page" };
            try {
                const j = await call(pageId, "POST", `${PANCAKE_PUBLIC_V1}/pages/${encodeURIComponent(pageId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
                    { page_access_token: a.pageToken }, { action: "reply_inbox", message: text });
                return { ok: true, messageId: j.id ? String(j.id) : j.message_id ? String(j.message_id) : null };
            } catch (e) {
                const pe = e instanceof PancakeError ? e : new PancakeError(String(e), { ambiguous: true });
                return { ok: false, error: pe.message, ambiguous: pe.ambiguous };
            }
        },

        async addTag(pageId, conversationId, tagName) {
            try {
                const want = tagName.trim().toLowerCase();
                let tag = (await listTags(pageId)).find((t) => t.text.trim().toLowerCase() === want);
                if (!tag) {
                    tagCache.delete(pageId);                          // admin vừa tạo tag thì lần sau nhận ngay
                    tag = (await listTags(pageId)).find((t) => t.text.trim().toLowerCase() === want);
                }
                if (!tag) return { ok: true, skipped: true, error: `page chưa tạo tag "${tagName}" — bỏ qua (tag là tuỳ chọn)` };
                const a = await o.auth(pageId);
                const j = await call(pageId, "POST", `${PANCAKE_PUBLIC_V1}/pages/${encodeURIComponent(pageId)}/conversations/${encodeURIComponent(conversationId)}/tags`,
                    { page_access_token: a.pageToken || "" }, { action: "add", tag_id: tag.id });
                // OpenAPI: data = danh sách id tag SAU khi cập nhật — soát tag đã có thật.
                if (Array.isArray(j.data) && !j.data.map(String).includes(tag.id)) {
                    return { ok: false, error: "Pancake trả thành công nhưng tag không có trong danh sách sau cập nhật" };
                }
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
            }
        },
    };
    return port;
}

export type PancakeClient = ReturnType<typeof createPancakeClient>;

/** Poller: hội thoại cần xem (lượt cuối KHÔNG phải page, hoặc không biết). */
export function conversationsNeedingCheck(rows: Raw[], pageId: string): { id: string; updatedAt: string | null }[] {
    return rows
        .filter((r) => r && r.id && String(r.type || "INBOX").toUpperCase() === "INBOX" && lastSentByPage(r, pageId) !== true)
        .map((r) => ({ id: String(r.id), updatedAt: r.updated_at ? String(r.updated_at) : null }));
}

/** Đọc token page CÓ SẴN bằng token tài khoản admin (OFFICIAL: GET /pages?fields=activated{id,settings{page_access_token}}). */
export async function readExistingPageTokens(fetchFn: FetchLike, accountToken: string, timeoutMs = 20_000): Promise<Map<string, string>> {
    const qs = new URLSearchParams({ access_token: accountToken, fields: "activated{id,username,settings{page_access_token}}" });
    const res = await fetchFn(`${PANCAKE_ACCOUNT_V1}/pages?${qs}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" } as RequestInit);
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.success === false) throw new PancakeError(`Pancake từ chối: ${j?.message || `HTTP ${res.status}`}`, { status: res.status });
    const pages = (j.activated || j.categorized?.activated || j.pages || []) as Raw[];
    const out = new Map<string, string>();
    for (const p of pages) {
        const tok = p?.settings?.page_access_token;
        if (p?.id && typeof tok === "string" && tok.length > 10) out.set(String(p.id), tok);
    }
    return out;
}
