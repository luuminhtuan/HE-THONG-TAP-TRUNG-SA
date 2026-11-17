import { NextRequest, NextResponse } from "next/server";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { getInboxThread, listInboxConversations, listInboxPages } from "@/lib/talpha/pancake-inbox";
import { assignableFor, parseInboxAction, visibleUsersFor } from "@/lib/talpha/inbox-rules";
import {
    assignConversation, conversationExists, createTag, inboxUsers, listTags, pageMarket, setConversationTag,
} from "@/lib/talpha/inbox-meta";

export const dynamic = "force-dynamic";

// Tab Tin nhắn (17/11/2026) — hộp thư Pancake đã kéo vào database (đọc) + gán người phụ trách / tag nội bộ (ghi trên
// dashboard, không đẩy về Pancake). Quyền tab ở access-rules (leader + giám đốc); route tự cắt page theo nước của người
// xem (lib/talpha/pancake-inbox.ts) và soát người được gán phải xem được nước của hội thoại (inbox-rules.ts).
//   GET                                   → {pages, tags, users}
//   GET ?list=1&page_id&market&q&label&assignee&before → {conversations}   (label / assignee = "none": chưa gắn / chưa gán)
//   GET ?page_id&conversation_id          → {conversation, messages}
//   POST {action: "assign", page_id, conversation_id, user_id | null}
//   POST {action: "tag", page_id, conversation_id, tag_id, on}
//   POST {action: "create_tag", name, color}
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const sp = req.nextUrl.searchParams;
    const pageId = sp.get("page_id") || undefined;
    const conversationId = sp.get("conversation_id");
    try {
        if (pageId && conversationId) {
            const thread = await getInboxThread(a, pageId, conversationId);
            if (!thread) return NextResponse.json({ error: "Không có hội thoại này, hoặc không thuộc nước của bạn" }, { status: 404 });
            return NextResponse.json(thread, { headers: NO_STORE });
        }
        if (sp.get("list") === "1") {
            const before = sp.get("before") || undefined;
            if (before && Number.isNaN(Date.parse(before))) return NextResponse.json({ error: "before phải là thời điểm" }, { status: 400 });
            const conversations = await listInboxConversations(a, {
                pageId, market: (sp.get("market") || "").toUpperCase() || undefined, q: sp.get("q") || undefined, before,
                label: sp.get("label") || undefined, assignee: sp.get("assignee") || undefined,
            });
            return NextResponse.json({ conversations }, { headers: NO_STORE });
        }
        const [pages, tags, users] = await Promise.all([listInboxPages(a), listTags(), inboxUsers()]);
        return NextResponse.json({ pages, tags, users: visibleUsersFor(a, users), seen_all: a.full }, { headers: NO_STORE });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    if (a.kind === "internal") return NextResponse.json({ error: "Chỉ người dùng gán / gắn tag được" }, { status: 403 });
    const parsed = parseInboxAction(await req.json().catch(() => null));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const actor = String(a.id || a.name || "");
    try {
        if (parsed.action === "create_tag") {
            return NextResponse.json({ ok: true, tag: await createTag(parsed.name, parsed.color, actor) });
        }
        const market = await pageMarket(parsed.page_id);
        if (market === undefined || !(await conversationExists(parsed.page_id, parsed.conversation_id))) {
            return NextResponse.json({ error: "Không có hội thoại này" }, { status: 404 });
        }
        if (!a.full && !(market && a.codes.includes(market))) {
            return NextResponse.json({ error: "Hội thoại không thuộc nước của bạn" }, { status: 403 });
        }
        if (parsed.action === "assign") {
            if (parsed.user_id) {
                const allowed = assignableFor(await inboxUsers(), market);
                if (!allowed.some((u) => u.id === parsed.user_id)) {
                    return NextResponse.json({ error: "Người này không xem được nước của hội thoại — không gán được" }, { status: 400 });
                }
            }
            const changed = await assignConversation(parsed.page_id, parsed.conversation_id, parsed.user_id, actor);
            return NextResponse.json({ ok: true, changed });
        }
        const changed = await setConversationTag(parsed.page_id, parsed.conversation_id, parsed.tag_id, parsed.on, actor);
        return NextResponse.json({ ok: true, changed });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
