// ═══════════════════════════════════════════════════════════════════
// Tab Tin nhắn (17/11/2026) — đọc hộp thư Pancake ĐÃ KÉO vào database (bảng pancake_*, migration 0004; việc nền
// sync/talpha/pancake_inbox_sync.py mỗi 5 phút). Không gọi Pancake lúc xem.
//
// Quyền: chỉ leader + giám đốc có tab (talpha_rules.json → access.roles). Người xem một phần nước chỉ thấy page gán
// nước của mình; page chưa gán được nước (market NULL) chỉ người xem hết thấy.
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";
import type { Access } from "./access-rules";

export type InboxPage = {
    page_id: string; name: string; market: string | null; last_sync_at: string | null; last_error: string | null;
    conversations: number;
};
export type InboxConversation = {
    page_id: string; conversation_id: string; page_name: string; market: string | null; type: string | null;
    customer_name: string | null; phone_numbers: string[]; snippet: string | null; tags: string[]; updated_at: string | null;
};
export type InboxMessage = {
    message_id: string; from_page: boolean; sender_name: string | null; body: string | null;
    attachments: { type: string; url: string; name: string | null }[]; sent_at: string | null;
};

/** Điều kiện SQL lọc page theo quyền — trả [mệnh đề, tham số]. Bảng page có bí danh `p`. */
function pageScope(a: Access): [string, Record<string, unknown>] {
    if (a.full) return ["TRUE", {}];
    return ["p.market = ANY(@codes::text[])", { codes: a.codes }];
}

export async function listInboxPages(a: Access): Promise<InboxPage[]> {
    const [where, params] = pageScope(a);
    return query<InboxPage>(
        `SELECT p.page_id, p.name, p.market, p.last_sync_at, p.last_error,
                (SELECT count(*)::int FROM pancake_conversations c WHERE c.page_id = p.page_id) AS conversations
           FROM pancake_pages p WHERE ${where} ORDER BY p.market NULLS LAST, p.name`, params);
}

export const CONVERSATIONS_PER_PAGE = 50;

/** Hội thoại mới nhất trước. `before` = updated_at của dòng cuối lượt trước (tải thêm). `q` tìm tên / số điện thoại / tin cuối. */
export async function listInboxConversations(a: Access, opts: { pageId?: string; market?: string; q?: string; before?: string }):
    Promise<InboxConversation[]> {
    const [where, params] = pageScope(a);
    const conds = [where];
    const p: Record<string, unknown> = { ...params, limit: CONVERSATIONS_PER_PAGE };
    if (opts.pageId) { conds.push("c.page_id = @pageId"); p.pageId = opts.pageId; }
    if (opts.market) { conds.push("p.market = @market"); p.market = opts.market; }
    if (opts.before) { conds.push("c.updated_at < @before::timestamptz"); p.before = opts.before; }
    const q = (opts.q || "").trim();
    if (q) {
        const digits = q.replace(/\D/g, "");
        conds.push(`(c.customer_name ILIKE @like OR c.snippet ILIKE @like${digits.length >= 3 ? " OR c.phone_numbers::text LIKE @digits" : ""})`);
        p.like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
        if (digits.length >= 3) p.digits = `%${digits}%`;
    }
    return query<InboxConversation>(
        `SELECT c.page_id, c.conversation_id, p.name AS page_name, p.market, c.type, c.customer_name, c.phone_numbers,
                c.snippet, c.tags, c.updated_at
           FROM pancake_conversations c JOIN pancake_pages p ON p.page_id = c.page_id
          WHERE ${conds.join(" AND ")}
          ORDER BY c.updated_at DESC NULLS LAST LIMIT @limit`, p);
}

/** Tin của một hội thoại, cũ → mới (tối đa 500 tin gần nhất). null = không có / không được xem. */
export async function getInboxThread(a: Access, pageId: string, conversationId: string):
    Promise<{ conversation: InboxConversation; messages: InboxMessage[] } | null> {
    const [where, params] = pageScope(a);
    const [conversation] = await query<InboxConversation>(
        `SELECT c.page_id, c.conversation_id, p.name AS page_name, p.market, c.type, c.customer_name, c.phone_numbers,
                c.snippet, c.tags, c.updated_at
           FROM pancake_conversations c JOIN pancake_pages p ON p.page_id = c.page_id
          WHERE ${where} AND c.page_id = @pageId AND c.conversation_id = @conversationId`, { ...params, pageId, conversationId });
    if (!conversation) return null;
    const messages = await query<InboxMessage>(
        `SELECT * FROM (
             SELECT message_id, from_page, sender_name, body, attachments, sent_at FROM pancake_messages
              WHERE page_id = @pageId AND conversation_id = @conversationId ORDER BY sent_at DESC NULLS LAST LIMIT 500
         ) t ORDER BY sent_at ASC NULLS FIRST`, { pageId, conversationId });
    return { conversation, messages };
}
