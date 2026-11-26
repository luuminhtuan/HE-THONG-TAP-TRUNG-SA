import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { stats } from "@/lib/ai-chatbot/admin-store";
import { bad, canSeePage, dateParam, ok, scopeOf, serverError } from "@/lib/ai-chatbot/route-helpers";
import { loadSettings } from "@/lib/ai-chatbot/runtime";

export const dynamic = "force-dynamic";

// AI Chatbot → Tổng quan: GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&page_id] — số tin AI tiếp nhận / trả lời / chuyển Sale, tỷ lệ
// tự xử lý, token, chi phí (chi phí chung chỉ người xem hết), chủ đề, theo page, theo ngày. Cắt theo nước của người xem.
export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const sp = req.nextUrl.searchParams;
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const from = dateParam(sp.get("from")) || today;
    const to = dateParam(sp.get("to")) || today;
    if (from > to) return bad("Khoảng ngày không hợp lệ");
    const scope = scopeOf(a);
    const pageId = sp.get("page_id") || null;
    try {
        if (pageId && !(await canSeePage(scope, pageId))) return bad("Page không thuộc nước của bạn", 403);
        const S = await loadSettings();
        const data = await stats(query, scope, from, to, pageId);
        return ok({ ...data, from, to, mode: S.mode, enabled: S.enabled });
    } catch (e) {
        return serverError(e, "stats");
    }
}
