// ═══════════════════════════════════════════════════════════════════
// Tab Tin nhắn — gán hội thoại cho người dùng + tag nội bộ (17/11/2026): phần THUẦN (soát thao tác, ai gán được cho
// ai). Phần đụng kho: inbox-meta.ts. Test: tests/inbox-rules.test.cjs.
// ═══════════════════════════════════════════════════════════════════

export const TAG_COLORS = ["slate", "red", "amber", "emerald", "sky", "violet", "pink"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_NAME_MAX = 40;

export type InboxAction =
    | { action: "assign"; page_id: string; conversation_id: string; user_id: string | null }
    | { action: "tag"; page_id: string; conversation_id: string; tag_id: number; on: boolean }
    | { action: "create_tag"; name: string; color: TagColor };

/** Người dùng của phần mềm, kèm nước họ xem được — để chọn người phụ trách hội thoại. */
export type InboxUser = { id: string; name: string; role: string; full: boolean; codes: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const idOf = (v: unknown) => (typeof v === "string" || typeof v === "number") && String(v).trim() ? String(v).trim().slice(0, 200) : "";

/** Tên tag: bỏ khoảng trắng thừa, tối đa TAG_NAME_MAX ký tự. Rỗng → "". */
export function normalizeTagName(s: unknown): string {
    return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, TAG_NAME_MAX);
}

/** Body POST /api/talpha/messages → thao tác hợp lệ, hoặc lỗi đọc được. */
export function parseInboxAction(body: unknown): InboxAction | { error: string } {
    if (!isRecord(body)) return { error: "Thiếu nội dung" };
    const action = String(body.action || "");
    if (action === "create_tag") {
        const name = normalizeTagName(body.name);
        if (!name) return { error: "Tên tag trống" };
        const color = (TAG_COLORS as readonly string[]).includes(String(body.color)) ? body.color as TagColor : "slate";
        return { action, name, color };
    }
    const page_id = idOf(body.page_id), conversation_id = idOf(body.conversation_id);
    if (!page_id || !conversation_id) return { error: "Thiếu page_id / conversation_id" };
    if (action === "assign") {
        const user_id = body.user_id == null || body.user_id === "" ? null : idOf(body.user_id);
        if (body.user_id != null && body.user_id !== "" && !user_id) return { error: "Người được gán không hợp lệ" };
        return { action, page_id, conversation_id, user_id };
    }
    if (action === "tag") {
        const tag_id = Number(body.tag_id);
        if (!Number.isInteger(tag_id) || tag_id <= 0) return { error: "Tag không hợp lệ" };
        return { action, page_id, conversation_id, tag_id, on: body.on !== false };
    }
    return { error: `Việc lạ: ${action || "(trống)"}` };
}

/** Ai nhận được hội thoại của nước `market`: người xem hết (giám đốc) + người xem được nước đó. Page chưa gán nước
 *  (market null) → chỉ người xem hết. */
export function assignableFor(users: InboxUser[], market: string | null): InboxUser[] {
    return users.filter((u) => u.full || (!!market && u.codes.includes(market)));
}

/** Người hiện trong bộ lọc "người phụ trách" của người xem: xem hết → mọi người; xem một phần → người xem hết + người
 *  chung ít nhất một nước. */
export function visibleUsersFor(viewer: { full: boolean; codes: string[] }, users: InboxUser[]): InboxUser[] {
    if (viewer.full) return users;
    return users.filter((u) => u.full || u.codes.some((c) => viewer.codes.includes(c)));
}
