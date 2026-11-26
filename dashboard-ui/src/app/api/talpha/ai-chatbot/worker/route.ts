import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { tickOnce, workerStatus } from "@/lib/ai-chatbot/worker";
import { bad, ok, serverError } from "@/lib/ai-chatbot/route-helpers";

export const dynamic = "force-dynamic";

// Worker AI Chatbot (chỉ giám đốc / chìa nội bộ — API_RULES full). GET = trạng thái worker + hàng đợi.
// POST = chạy một vòng ngay (quét page + xử lý job tới hạn) — cho việc nền ngoài / kiểm tra tay.
export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    try {
        const queue = await query(`SELECT status, count(*)::int AS n FROM ai_bot_jobs GROUP BY 1`);
        return ok({ worker: workerStatus(), queue: Object.fromEntries(queue.map((r) => [r.status, r.n])) });
    } catch (e) {
        return serverError(e, "worker GET");
    }
}

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    if (!a.full) return bad("Chỉ giám đốc", 403);
    try {
        return ok({ ok: true, ...(await tickOnce()) });
    } catch (e) {
        return serverError(e, "worker POST");
    }
}
