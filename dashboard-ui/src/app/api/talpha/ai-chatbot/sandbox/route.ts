import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { processTurn } from "@/lib/ai-chatbot/router";
import { MemoryStore } from "@/lib/ai-chatbot/memory-store";
import type { ChatMessage, ChatPort } from "@/lib/ai-chatbot/types";
import { aiPort, loadSettings, runtime } from "@/lib/ai-chatbot/runtime";
import { bad, canSeePage, ok, readJson, scopeOf, serverError } from "@/lib/ai-chatbot/route-helpers";

export const dynamic = "force-dynamic";

// AI Chatbot → "Chạy thử" (sandbox): chạy ĐỦ quy trình Router (sổ luật POS, phân loại, RAG, sinh câu trả lời, soát căn cứ,
// độ tin cậy) trên hội thoại GIẢ do người dùng gõ — KHÔNG đọc / gửi Pancake, KHÔNG ghi nhật ký / Learning / Telegram
// (kho trong bộ nhớ). Có gọi AI thật (tính tiền, ghi ai_bot_provider_calls purpose = sandbox) và đọc Knowledge Base thật
// theo phạm vi page / nước đã chọn.
//   POST {page_id?, market?, messages: [{from: "customer" | "page", text}], first_turn?: boolean}
// Chạy thử gọi AI thật và tính chung trần chi phí — giới hạn mỗi người 20 lượt / 10 phút, kẻo bấm nhiều chạm trần ngày
// làm bot thật phải chuyển Sale mọi tin.
const SANDBOX_LIMIT = 20;
const SANDBOX_WINDOW_MS = 10 * 60_000;
const sandboxHits = new Map<string, number[]>();

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const scope = scopeOf(a);
    const t = Date.now();
    const hits = (sandboxHits.get(scope.actor) || []).filter((x) => t - x < SANDBOX_WINDOW_MS);
    if (hits.length >= SANDBOX_LIMIT) return bad(`Chạy thử tối đa ${SANDBOX_LIMIT} lượt / 10 phút — thử lại sau`, 429);
    hits.push(t);
    sandboxHits.set(scope.actor, hits);
    try {
        const b = await readJson(req, 20_000);
        const msgs = Array.isArray(b?.messages) ? b.messages.slice(-20) : [];
        if (!msgs.length || msgs[msgs.length - 1]?.from !== "customer") return bad("Tin cuối phải là của khách");
        if (msgs.some((m: any) => typeof m?.text !== "string" || m.text.length > 2000)) return bad("Mỗi tin tối đa 2000 ký tự");
        const pageId = b.page_id ? String(b.page_id) : "";
        let market: string | null = b.market ? String(b.market).toUpperCase() : null;
        let pageName = "Shop thử";
        if (pageId) {
            if (!/^[\w.:-]{1,80}$/.test(pageId) || !(await canSeePage(scope, pageId))) return bad("Page không hợp lệ / không thuộc nước của bạn", 403);
            const [p] = await query<{ name: string; market: string | null }>("SELECT name, market FROM pancake_pages WHERE page_id = @pageId", { pageId });
            market = p?.market || market;
            pageName = p?.name || pageId;
        }
        if (!scope.full && !(market && scope.codes.includes(market))) return bad("Chọn page / nước thuộc team của bạn", 403);

        const base = await loadSettings(true);
        // Chạy thử: luôn shadow, không chờ debounce / ân hạn, không Telegram, không tạm dừng sau chuyển Sale.
        const S = { ...base, enabled: true, mode: "shadow" as const, debounce_seconds: 0, pos_grace_seconds: 0, escalation_pause_minutes: 0,
            telegram: { ...base.telegram, enabled: false }, max_turn_age_minutes: 1440 };
        const now = Date.now();
        const pid = pageId || "sandbox";
        const store = new MemoryStore(() => now);
        store.pages.set(pid, { pageId: pid, name: pageName, market, enabled: true, canSend: false });
        const rt = runtime();
        store.rules = (await rt.pg.store.listPosRules(pid));
        store.kb = await rt.pg.store.knowledgeCandidates({ pageId: pid, market });
        // Chi phí chạy thử tính chung trần chi phí THẬT (bảng ai_bot_provider_calls).
        store.costSince = (since: number) => rt.pg.store.costSince(since);
        const messages: ChatMessage[] = msgs.map((m: any, i: number) => ({
            id: `sb${i}`, kind: m.from === "customer" ? "customer" : "human", text: String(m.text),
            at: now - (msgs.length - i) * 120_000,
        }));
        if (b.first_turn !== true && messages[0]?.kind === "customer") {
            messages.unshift({ id: "sb-sys", kind: "pos_auto", text: "(lời chào tự động của POS)", at: now - (msgs.length + 1) * 120_000 });
        }
        const chat: ChatPort = {
            async fetchConversation() { return { conversation: { id: "sandbox", pageId: pid, tags: [], assigneeIds: [], customerName: "Khách thử" }, messages, complete: true }; },
            async sendText() { return { ok: false, error: "sandbox" }; },
            async addTag() { return { ok: true }; },
        };
        const out = await processTurn({ jobId: null, pageId: pid, conversationId: "sandbox", attempt: 1, source: "sandbox" }, {
            store, chat, ai: aiPort(() => S, { pageId: pageId || null, purposeOverride: "sandbox" }), notifier: null,
            now: () => now, settings: () => S, links: () => ({ dashboardUrl: null, pancakeUrl: null }),
        });
        const run = store.runs[0] || null;
        return ok({
            outcome: out.kind, decision: run?.decision ?? null, reason: "reason" in out ? out.reason : null, answer: run?.answer ?? null,
            confidence: run?.confidence ?? null, classification: run?.classification ?? null, retrieved: run?.retrieved ?? [],
            tokens: run ? run.inputTokens + run.outputTokens : 0, cost_usd: run?.costUsd ?? 0, trace: out.trace,
            learning: store.unanswered.map((u) => u.text), kb_size: store.kb.length,
        });
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        if (e?.name === "AiError") return bad(e.message, 502);
        return serverError(e, "sandbox");
    }
}
