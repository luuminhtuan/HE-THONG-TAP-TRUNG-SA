// ═══════════════════════════════════════════════════════════════════
// Tab Tin nhắn — gán hội thoại + tag nội bộ (17/11/2026): phần ĐỤNG KHO (migration 0005). Mỗi thay đổi ghi một dòng
// inbox_events trong CÙNG transaction — KPI người dùng tính từ nhật ký đó. Không đổi gì (gán lại đúng người cũ, gắn
// tag đã có) thì không ghi. Phần thuần: inbox-rules.ts.
// ═══════════════════════════════════════════════════════════════════
import { query, withTransaction } from "@/lib/db";
import { loadUsers } from "@/lib/users";
import { accessForUser } from "./access-rules";
import type { InboxUser, TagColor } from "./inbox-rules";

export type InboxTag = { id: number; name: string; color: string };

/** Người dùng đang hoạt động + nước họ xem được (cùng luật phân quyền của dashboard). */
export async function inboxUsers(): Promise<InboxUser[]> {
    return (await loadUsers()).filter((u) => u.status !== "pending").map((u) => {
        const a = accessForUser({ id: u.id, name: u.name, role: u.role, teams: u.teams, email: u.email });
        return { id: u.id, name: u.name, role: u.role, full: a.full, codes: a.codes };
    }).sort((x, y) => x.name.localeCompare(y.name, "vi"));
}

export async function listTags(): Promise<InboxTag[]> {
    return query<InboxTag>("SELECT id::int AS id, name, color FROM inbox_tags ORDER BY lower(name)");
}

/** Tạo tag; trùng tên (không phân biệt hoa thường) thì trả tag đã có. */
export async function createTag(name: string, color: TagColor, actor: string): Promise<InboxTag> {
    await query("INSERT INTO inbox_tags (name, color, created_by) VALUES (@name, @color, @actor) ON CONFLICT DO NOTHING", { name, color, actor });
    const [tag] = await query<InboxTag>("SELECT id::int AS id, name, color FROM inbox_tags WHERE lower(name) = lower(@name)", { name });
    return tag;
}

/** Nước của page (null = chưa gán nước), undefined = không có page. */
export async function pageMarket(pageId: string): Promise<string | null | undefined> {
    const [row] = await query<{ market: string | null }>("SELECT market FROM pancake_pages WHERE page_id = @pageId", { pageId });
    return row ? row.market : undefined;
}

export async function conversationExists(pageId: string, conversationId: string): Promise<boolean> {
    const rows = await query("SELECT 1 FROM pancake_conversations WHERE page_id = @pageId AND conversation_id = @conversationId",
        { pageId, conversationId });
    return rows.length > 0;
}

/** Gán (userId) / bỏ gán (null). Trả true nếu có đổi. */
export async function assignConversation(pageId: string, conversationId: string, userId: string | null, actor: string): Promise<boolean> {
    return withTransaction(async (q) => {
        const [cur] = await q<{ user_id: string }>(
            "SELECT user_id FROM inbox_assignments WHERE page_id = @pageId AND conversation_id = @conversationId FOR UPDATE",
            { pageId, conversationId });
        const prev = cur?.user_id ?? null;
        if (prev === userId) return false;
        if (userId) {
            await q(`INSERT INTO inbox_assignments (page_id, conversation_id, user_id, assigned_by, assigned_at)
                     VALUES (@pageId, @conversationId, @userId, @actor, now())
                     ON CONFLICT (page_id, conversation_id) DO UPDATE SET user_id = EXCLUDED.user_id,
                         assigned_by = EXCLUDED.assigned_by, assigned_at = now()`, { pageId, conversationId, userId, actor });
        } else {
            await q("DELETE FROM inbox_assignments WHERE page_id = @pageId AND conversation_id = @conversationId", { pageId, conversationId });
        }
        await q(`INSERT INTO inbox_events (page_id, conversation_id, kind, user_id, prev_user_id, actor)
                 VALUES (@pageId, @conversationId, @kind, @userId, @prev, @actor)`,
            { pageId, conversationId, kind: userId ? "assign" : "unassign", userId, prev, actor });
        return true;
    });
}

/** Gắn (on) / gỡ tag. Trả true nếu có đổi; false nếu không có tag đó hoặc đã đúng như vậy. */
export async function setConversationTag(pageId: string, conversationId: string, tagId: number, on: boolean, actor: string): Promise<boolean> {
    return withTransaction(async (q) => {
        const [tag] = await q<{ name: string }>("SELECT name FROM inbox_tags WHERE id = @tagId", { tagId });
        if (!tag) return false;
        const changed = on
            ? (await q(`INSERT INTO inbox_conversation_tags (page_id, conversation_id, tag_id, tagged_by)
                        VALUES (@pageId, @conversationId, @tagId, @actor) ON CONFLICT DO NOTHING RETURNING tag_id`,
                { pageId, conversationId, tagId, actor })).length > 0
            : (await q(`DELETE FROM inbox_conversation_tags WHERE page_id = @pageId AND conversation_id = @conversationId AND tag_id = @tagId
                        RETURNING tag_id`, { pageId, conversationId, tagId })).length > 0;
        if (changed) {
            await q(`INSERT INTO inbox_events (page_id, conversation_id, kind, tag_id, tag_name, actor)
                     VALUES (@pageId, @conversationId, @kind, @tagId, @tagName, @actor)`,
                { pageId, conversationId, kind: on ? "tag" : "untag", tagId, tagName: tag.name, actor });
        }
        return changed;
    });
}
