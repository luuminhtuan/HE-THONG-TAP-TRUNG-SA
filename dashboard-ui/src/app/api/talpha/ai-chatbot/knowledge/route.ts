import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import {
    canWriteKbScope, createKb, deleteKb, getKb, kbEntryScope, listKb, listPages, parseKbInput, setKbEnabled, updateKb,
} from "@/lib/ai-chatbot/admin-store";
import { MARKET_CODE } from "@/lib/talpha/access-rules";
import { bad, intParam, ok, readJson, scopeOf, serverError } from "@/lib/ai-chatbot/route-helpers";
import { runtime } from "@/lib/ai-chatbot/runtime";
import { kbSyncRunning, syncPosKnowledge } from "@/lib/ai-chatbot/kb-sync";

export const dynamic = "force-dynamic";

// AI Chatbot → Knowledge Base.
//   GET ?q&kind&source&scope&market&enabled&page&size  → danh sách (phân trang, tìm không dấu)
//   GET ?id=                                           → một mục + lịch sử cập nhật
//   POST {…mục}                                        → thêm (mục admin bổ sung; sản phẩm chỉ đến từ đồng bộ POS)
//   POST {action: "toggle", id, enabled}               → bật / tắt
//   POST {action: "sync"}                              → đồng bộ sản phẩm POS ngay (chỉ người xem hết)
//   PUT  {id, …mục}                                    → sửa (mục đồng bộ POS không sửa nội dung — chỉ bật / tắt)
//   DELETE ?id=                                        → xoá mềm (lịch sử giữ)
// Ghi mục chung: chỉ người xem hết; mục theo nước / page: người thuộc nước đó.
export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const sp = req.nextUrl.searchParams;
    const scope = scopeOf(a);
    try {
        if (sp.get("meta") === "1") {
            // Cho form + khung chạy thử: page và nước người xem được.
            const pages = await listPages(query, scope);
            const markets = scope.full ? Object.values(MARKET_CODE) : scope.codes;
            return ok({ pages: pages.map((p) => ({ page_id: p.page_id, name: p.name, market: p.market })), markets, full: scope.full });
        }
        if (sp.get("id")) {
            const id = intParam(sp.get("id"));
            if (!id) return bad("id không hợp lệ");
            const r = await getKb(query, scope, id);
            return r ? ok(r) : bad("Không có mục này, hoặc không thuộc nước của bạn", 404);
        }
        const data = await listKb(query, scope, {
            q: (sp.get("q") || "").slice(0, 100) || undefined, kind: sp.get("kind") || undefined, source: sp.get("source") || undefined,
            scope: sp.get("scope") || undefined, market: (sp.get("market") || "").toUpperCase() || undefined,
            enabled: sp.get("enabled") || undefined, page: sp.get("page"), size: sp.get("size"),
        });
        return ok({ ...data, sync_running: kbSyncRunning(), can_write_global: scope.full });
    } catch (e) {
        return serverError(e, "knowledge GET");
    }
}

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const scope = scopeOf(a);
    try {
        const b = await readJson(req);
        if (b?.action === "sync") {
            if (!scope.full) return bad("Chỉ giám đốc đồng bộ được sản phẩm POS", 403);
            const results = await syncPosKnowledge(scope.actor);
            runtime().pg.invalidateKb();
            return ok({ ok: true, results });
        }
        if (b?.action === "toggle") {
            const id = Number(b.id);
            const cur = Number.isInteger(id) ? await kbEntryScope(query, id) : null;
            if (!cur) return bad("Không có mục này", 404);
            if (!(await canWriteKbScope(query, scope, cur))) return bad("Không được sửa mục thuộc phạm vi này", 403);
            await setKbEnabled(query, scope, id, b.enabled === true);
            runtime().pg.invalidateKb();
            return ok({ ok: true });
        }
        const parsed = parseKbInput(b);
        if (!parsed.ok) return bad(parsed.errors);
        if (!(await canWriteKbScope(query, scope, parsed.value))) return bad("Không được thêm kiến thức cho phạm vi này", 403);
        const id = await createKb(query, scope, parsed.value);
        runtime().pg.invalidateKb();
        return ok({ ok: true, id });
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        return serverError(e, "knowledge POST");
    }
}

export async function PUT(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const scope = scopeOf(a);
    try {
        const b = await readJson(req);
        const id = Number(b?.id);
        const cur = Number.isInteger(id) ? await kbEntryScope(query, id) : null;
        if (!cur) return bad("Không có mục này", 404);
        const parsed = parseKbInput(b);
        if (!parsed.ok) return bad(parsed.errors);
        if (!(await canWriteKbScope(query, scope, cur)) || !(await canWriteKbScope(query, scope, parsed.value))) {
            return bad("Không được sửa mục thuộc phạm vi này", 403);
        }
        const r = await updateKb(query, scope, id, parsed.value);
        if (r === "official") return bad("Mục đồng bộ từ POS là dữ liệu chính thức — sửa trên POS rồi đồng bộ lại (ở đây chỉ bật / tắt)", 409);
        if (r === "not_found") return bad("Không có mục này", 404);
        runtime().pg.invalidateKb();
        return ok({ ok: true });
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        return serverError(e, "knowledge PUT");
    }
}

export async function DELETE(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const scope = scopeOf(a);
    try {
        const id = intParam(req.nextUrl.searchParams.get("id"));
        const cur = id ? await kbEntryScope(query, id) : null;
        if (!id || !cur) return bad("Không có mục này", 404);
        if (!(await canWriteKbScope(query, scope, cur))) return bad("Không được xoá mục thuộc phạm vi này", 403);
        const r = await deleteKb(query, scope, id);
        if (r === "official") return bad("Mục đồng bộ từ POS không xoá được — tắt mục thay vì xoá", 409);
        runtime().pg.invalidateKb();
        return ok({ ok: true });
    } catch (e) {
        return serverError(e, "knowledge DELETE");
    }
}
