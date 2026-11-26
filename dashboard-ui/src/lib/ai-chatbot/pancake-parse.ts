// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — đọc dữ liệu thô của Pancake (THUẦN, có test). Trường theo OpenAPI chính thức
// (developer.pancake.biz/openapi/openapi.yaml, đọc 25/11/2026) + điều bot AI Sale cũ đo được trên dữ liệu thật.
// Chịu thiếu trường: thiếu thì để trống, không làm hỏng cả lượt.
// ═══════════════════════════════════════════════════════════════════
import type { ChatMessage, ConversationInfo, SenderKind } from "./types";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** "2026-11-16T09:08:04.102000" (UTC không múi — OpenAPI: mọi giờ là UTC+0 không ghi múi) / có Z / epoch → ms. */
export function parsePancakeTime(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v > 1e12 ? v : v * 1000;
    const s = String(v).trim();
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
    return Number.isNaN(t) ? null : t;
}

const BREAK_RE = /<br\s*\/?>|<\/(?:div|p|li)>/gi;
const TAG_RE = /<[^>]+>/g;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

/** Tin HTML của Pancake → chữ trơn. */
export function htmlToText(s: string): string {
    return str(s).replace(BREAK_RE, "\n").replace(TAG_RE, "")
        .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] || m)
        .split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type SenderContext = {
    pageId: string;
    /** Tên người gửi khi module gửi bằng token page — bot cũ đo: "Public API". */
    ownSenderNames: string[];
    /** Id tin module đã gửi (outbox) — chắc chắn nhất. */
    ownMessageIds: Set<string>;
    /** Chữ tin module đã gửi (gọn khoảng trắng) — dự phòng khi id Pancake trả lúc gửi khác id trong danh sách tin. */
    ownTexts?: Set<string>;
};

/** Gọn khoảng trắng để so chữ tin đã gửi. */
export const compactText = (s: string) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Ai gửi tin này. Thứ tự: khách → tin của chính module (id trong outbox) → luật tự động (`from.is_automated`, OFFICIAL)
 * → Botcake (`admin_name` "Botcake…", hoặc `app_id`+`flow_id`) → AI khác của Pancake (`ai_generated`) → tin hệ thống
 * (không admin_name) → tên gửi của module → người thật.
 */
export function classifySender(raw: Raw, ctx: SenderContext): SenderKind {
    const from = isObj(raw.from) ? raw.from : {};
    const fromId = str(from.id);
    const isPageSide = !!(raw.is_page || raw.from_page || (fromId && fromId === ctx.pageId));
    if (!isPageSide) return "customer";
    const id = str(raw.id || raw.message_id);
    if (id && ctx.ownMessageIds.has(id)) return "ai_self";
    if (from.is_automated === true || raw.is_automated === true) return "pos_auto";
    const adminName = str(from.admin_name).trim();
    if (/botcake/i.test(adminName) || (raw.app_id && raw.flow_id)) return "botcake";
    if (from.ai_generated === true || raw.ai_generated === true) return "pos_auto";
    if (!adminName) return "system";
    if (ctx.ownSenderNames.some((n) => n && n.toLowerCase() === adminName.toLowerCase())) {
        // Cùng tên gửi "Public API" nhưng không phải tin module này gửi → BOT KHÁC (vd bot AI Sale cũ cùng page).
        const text = compactText(String(raw.original_message ?? raw.text ?? htmlToText(str(raw.message))));
        return ctx.ownTexts?.has(text) ? "ai_self" : "other_bot";
    }
    return "human";
}

/** Một tin thô → ChatMessage. Chữ lấy `original_message` (chữ trơn), thiếu thì bóc HTML của `message`. */
export function normalizeMessage(raw: Raw, ctx: SenderContext): ChatMessage | null {
    const id = str(raw.id || raw.message_id);
    if (!id) return null;
    const plain = raw.original_message ?? raw.text ?? null;
    let text = plain !== null && plain !== undefined ? str(plain).trim() : htmlToText(str(raw.message));
    const atts = Array.isArray(raw.attachments) ? raw.attachments.filter(isObj) : [];
    if (!text) {
        text = atts.filter((a) => a.type === "system_message" && a.message).map((a) => str(a.message).trim()).join(" · ");
    }
    const from = isObj(raw.from) ? raw.from : {};
    return {
        id,
        kind: classifySender(raw, ctx),
        text,
        at: parsePancakeTime(raw.inserted_at ?? raw.created_time ?? raw.created_at) ?? 0,
        senderName: str(from.admin_name || from.name) || null,
        hasAttachment: atts.some((a) => a.type !== "system_message"),
    };
}

/** Danh sách tin thô (mới → cũ theo OpenAPI, hoặc lộn xộn) → cũ → mới, bỏ trùng id. */
export function normalizeMessages(raws: unknown[], ctx: SenderContext): ChatMessage[] {
    const seen = new Set<string>();
    const out: ChatMessage[] = [];
    for (const r of raws || []) {
        if (!isObj(r)) continue;
        const m = normalizeMessage(r, ctx);
        if (!m || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
    }
    return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/** Hội thoại thô → ConversationInfo. `tags` có thể là [{id,text}] (public API, phần tử có thể null) hoặc [id] (webhook). */
export function normalizeConversation(raw: Raw, pageId: string, tagNames: Map<string, string> = new Map()): ConversationInfo {
    const tags: string[] = [];
    for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
        if (t === null || t === undefined) continue;
        if (isObj(t)) {
            if (t.is_deactive === true) continue;
            const name = str(t.text || t.name) || tagNames.get(str(t.id)) || "";
            if (name) tags.push(name);
        } else {
            const name = tagNames.get(str(t));
            if (name) tags.push(name);
        }
    }
    const assignees = new Set<string>();
    for (const a of Array.isArray(raw.assignee_ids) ? raw.assignee_ids : []) if (a) assignees.add(str(a));
    for (const u of Array.isArray(raw.current_assign_users) ? raw.current_assign_users : []) {
        if (isObj(u) && u.id) assignees.add(str(u.id));
    }
    const customers = Array.isArray(raw.customers) ? raw.customers.filter(isObj) : [];
    const from = isObj(raw.from) ? raw.from : {};
    return {
        id: str(raw.id),
        pageId,
        type: raw.type ? str(raw.type) : null,
        tags,
        assigneeIds: [...assignees],
        customerName: str(from.name || customers[0]?.name) || null,
        insertedAt: parsePancakeTime(raw.inserted_at),
    };
}

/** Mã khách PANCAKE (customers[].id) — API đọc tin bằng token tài khoản bắt buộc có. */
export function pancakeCustomerId(raw: Raw): string | null {
    const customers = Array.isArray(raw.customers) ? raw.customers.filter(isObj) : [];
    const id = customers.find((c) => c.id)?.id;
    return id ? str(id) : null;
}

/** Lượt gửi cuối của hội thoại là phía page? (`last_sent_by` OFFICIAL). null = không biết. Poller dùng để khỏi đọc tin
 *  của hội thoại page vừa trả lời. */
export function lastSentByPage(raw: Raw, pageId: string): boolean | null {
    const l = isObj(raw.last_sent_by) ? raw.last_sent_by : null;
    if (!l) return null;
    if (l.admin_name || l.admin_id || l.uid || l.is_automated === true) return true;
    const id = str(l.id);
    if (!id) return null;
    return id === pageId;
}

export type WebhookHint = { pageId: string; conversationId: string; messageId: string | null; fromCustomer: boolean | null; eventType: string };

/**
 * Gợi ý từ payload webhook (OFFICIAL: `{page_id, event_type, data:{conversation, message}}`). Chỉ lấy ĐỊA CHỈ — nội dung
 * tin luôn đọc lại bằng API (payload không có admin_name / is_automated, và webhook không có chữ ký).
 */
export function parseWebhookHints(body: unknown): WebhookHint[] {
    const items = Array.isArray(body) ? body : [body];
    const out: WebhookHint[] = [];
    for (const it of items) {
        if (!isObj(it)) continue;
        const data = isObj(it.data) ? it.data : {};
        const conv = isObj(data.conversation) ? data.conversation : {};
        const msg = isObj(data.message) ? data.message : {};
        const pageId = str(it.page_id || msg.page_id || conv.page_id);
        const conversationId = str(conv.id || msg.conversation_id);
        if (!/^[\w.:-]{1,80}$/.test(pageId) || !/^[\w.:-]{1,120}$/.test(conversationId)) continue;
        const from = isObj(msg.from) ? msg.from : null;
        const type = str(conv.type || "").toUpperCase();
        if (type && type !== "INBOX") continue;          // bình luận / livestream: module chỉ trả lời hộp thư
        out.push({
            pageId,
            conversationId,
            messageId: msg.id ? str(msg.id) : null,
            fromCustomer: from ? str(from.id) !== pageId : null,
            eventType: str(it.event_type || "unknown"),
        });
    }
    return out;
}
