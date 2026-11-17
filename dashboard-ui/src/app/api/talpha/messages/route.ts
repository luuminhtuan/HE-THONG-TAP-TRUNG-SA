import { NextRequest, NextResponse } from "next/server";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { getInboxThread, listInboxConversations, listInboxPages } from "@/lib/talpha/pancake-inbox";

export const dynamic = "force-dynamic";

// Tab Tin nhắn (17/11/2026) — hộp thư Pancake đã kéo vào database, CHỈ ĐỌC. Quyền tab ở access-rules (leader + giám
// đốc); route tự cắt page theo nước của người xem (lib/talpha/pancake-inbox.ts).
//   GET                          → {pages}
//   GET ?list=1&page_id&market&q&before → {conversations}
//   GET ?page_id&conversation_id → {conversation, messages}
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
            return NextResponse.json(thread, { headers: { "Cache-Control": "no-store" } });
        }
        if (sp.get("list") === "1") {
            const before = sp.get("before") || undefined;
            if (before && Number.isNaN(Date.parse(before))) return NextResponse.json({ error: "before phải là thời điểm" }, { status: 400 });
            const conversations = await listInboxConversations(a, {
                pageId, market: (sp.get("market") || "").toUpperCase() || undefined, q: sp.get("q") || undefined, before,
            });
            return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
        }
        return NextResponse.json({ pages: await listInboxPages(a), seen_all: a.full }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
