import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { approveLearning, draftLearning, getLearning, learningMarket, listLearning, setLearningStatus } from "@/lib/ai-chatbot/admin-store";
import { LEARNING_STATUSES, type LearningStatus } from "@/lib/ai-chatbot/learning";
import { bad, intParam, ok, readJson, scopeOf, serverError } from "@/lib/ai-chatbot/route-helpers";
import { runtime } from "@/lib/ai-chatbot/runtime";

export const dynamic = "force-dynamic";

// AI Chatbot → AI Learning: câu hỏi AI chưa trả lời được, gom nhóm câu tương tự.
//   GET ?status&q&page&size → danh sách nhóm (số lần xuất hiện, lý do)   GET ?id= → chi tiết + các lần khách hỏi + lịch sử
//   POST {action: "status", id, status: pending|processing|ignored}
//   POST {action: "draft", id, answer}                      → lưu nháp (đang xử lý)
//   POST {action: "approve", id, answer, question?}         → tạo FAQ trong Knowledge Base, nhóm "đã duyệt"
// AI KHÔNG tự sửa kiến thức — chỉ người duyệt mới thêm FAQ.
export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const sp = req.nextUrl.searchParams;
    const scope = scopeOf(a);
    try {
        if (sp.get("id")) {
            const id = intParam(sp.get("id"));
            if (!id) return bad("id không hợp lệ");
            const r = await getLearning(query, scope, id);
            return r ? ok(r) : bad("Không có câu hỏi này, hoặc không thuộc nước của bạn", 404);
        }
        const status = sp.get("status");
        if (status && !(LEARNING_STATUSES as readonly string[]).includes(status)) return bad("status không hợp lệ");
        return ok(await listLearning(query, scope, { status: status || undefined, q: (sp.get("q") || "").slice(0, 100) || undefined, page: sp.get("page"), size: sp.get("size") }));
    } catch (e) {
        return serverError(e, "learning GET");
    }
}

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    if (a.kind === "internal") return bad("Chỉ người dùng duyệt được câu hỏi", 403);
    const scope = scopeOf(a);
    try {
        const b = await readJson(req);
        const id = Number(b?.id);
        if (!Number.isInteger(id) || id <= 0) return bad("id không hợp lệ");
        const market = await learningMarket(query, id);
        if (market === undefined) return bad("Không có câu hỏi này", 404);
        if (!scope.full && !(market && scope.codes.includes(market))) return bad("Câu hỏi không thuộc nước của bạn", 403);
        if (b.action === "status") {
            const to = String(b.status) as LearningStatus;
            if (!(LEARNING_STATUSES as readonly string[]).includes(to)) return bad("status không hợp lệ");
            const r = await setLearningStatus(query, scope, id, to);
            return r === "ok" ? ok({ ok: true }) : bad(r === "invalid" ? "Không chuyển được sang trạng thái này (duyệt phải kèm câu trả lời)" : "Không có câu hỏi này", r === "invalid" ? 409 : 404);
        }
        if (b.action === "draft") {
            return (await draftLearning(query, scope, id, String(b.answer || ""))) ? ok({ ok: true }) : bad("Câu hỏi đã duyệt / bỏ qua — không lưu nháp", 409);
        }
        if (b.action === "approve") {
            const r = await approveLearning(query, scope, id, String(b.answer || ""), b.question ? String(b.question).slice(0, 300) : undefined);
            if (!r.ok) return bad(r.error, 409);
            runtime().pg.invalidateKb();
            return ok({ ok: true, kb_entry_id: r.kbId });
        }
        return bad("action không hợp lệ");
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        return serverError(e, "learning POST");
    }
}
