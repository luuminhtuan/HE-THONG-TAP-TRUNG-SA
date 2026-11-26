import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { pauseConversation } from "@/lib/ai-chatbot/admin-store";
import { bad, canSeePage, ok, readJson, scopeOf, serverError } from "@/lib/ai-chatbot/route-helpers";
import { enqueueConversation } from "@/lib/ai-chatbot/worker";

export const dynamic = "force-dynamic";

// AI ở MỘT hội thoại — Sale tiếp nhận / trả lại:
//   POST {action: "pause", page_id, conversation_id, minutes}   → AI không chen vào hội thoại này (mặc định 24 giờ)
//   POST {action: "resume", page_id, conversation_id}           → bỏ tạm dừng
//   POST {action: "process_now", page_id, conversation_id}      → đưa vào hàng chờ xử lý ngay (vẫn qua đủ các bước soát)
export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const scope = scopeOf(a);
    try {
        const b = await readJson(req, 4000);
        const pageId = String(b?.page_id || "");
        const conversationId = String(b?.conversation_id || "");
        if (!/^[\w.:-]{1,80}$/.test(pageId) || !/^[\w.:-]{1,120}$/.test(conversationId)) return bad("page_id / conversation_id không hợp lệ");
        if (!(await canSeePage(scope, pageId))) return bad("Hội thoại không thuộc nước của bạn", 403);
        if (b.action === "pause") {
            const minutes = Math.min(30 * 24 * 60, Math.max(1, Number(b.minutes) || 24 * 60));
            await pauseConversation(query, scope, pageId, conversationId, minutes);
            return ok({ ok: true, paused_minutes: minutes });
        }
        if (b.action === "resume") {
            await pauseConversation(query, scope, pageId, conversationId, 0);
            return ok({ ok: true });
        }
        if (b.action === "process_now") {
            const jobId = await enqueueConversation(pageId, conversationId, "manual");
            return ok({ ok: true, job_id: jobId });
        }
        return bad("action không hợp lệ");
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        return serverError(e, "conversation");
    }
}
