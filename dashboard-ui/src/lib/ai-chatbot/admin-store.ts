// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — truy vấn cho các trang quản trị (Dashboard, Knowledge Base, AI Learning, Logs, Settings). Hàm `query`
// TIÊM VÀO (không import "@/…") để test tích hợp gọi thẳng được.
//
// Cách ly theo nước: `scope.full` = xem mọi page / nước; không thì chỉ page có market ∈ scope.codes (page chưa gán nước
// chỉ giám đốc thấy — cùng luật tab Tin nhắn). Mọi tham số qua @tên (không ghép chuỗi SQL).
// ═══════════════════════════════════════════════════════════════════
import type { QueryFn } from "./store-pg";
import { mapKb, toMs } from "./store-pg";
import { faqKeywords, canTransition, type LearningStatus } from "./learning";
import { validRegex } from "./pos-detect";
import type { KbKind, KbScope } from "./types";

export type Scope = { full: boolean; codes: string[]; actor: string };

const PAGE_SIZE_MAX = 100;
const clampSize = (n: unknown, d = 25) => Math.min(PAGE_SIZE_MAX, Math.max(1, Math.round(Number(n) || d)));
const clampPage = (n: unknown) => Math.max(1, Math.round(Number(n) || 1));
const iso = (v: unknown) => { const t = toMs(v); return t === null ? null : new Date(t).toISOString(); };

// Ngày lọc (from / to, "YYYY-MM-DD") là ngày GIỜ VIỆT NAM: pool chạy TimeZone=UTC nên @from::date trần là 00:00 UTC —
// "hôm nay" sẽ thiếu tin 0–7 giờ sáng. Mọi mốc ngày ở file này đổi qua AT TIME ZONE 'Asia/Ho_Chi_Minh'.

/** Điều kiện SQL "market của dòng nằm trong nước người xem" (cột truyền vào). */
const marketCond = (col: string) => `(@full OR ${col} = ANY(@codes))`;

// ─── Số liệu (Dashboard) ───────────────────────────────────────────

export async function stats(q: QueryFn, scope: Scope, from: string, to: string, pageId?: string | null) {
    const p = { full: scope.full, codes: scope.codes, from, to, pageId: pageId || null };
    const where = `r.created_at >= ((@from::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND r.created_at < ((@to::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND ${marketCond("r.market")}
        AND (@pageId::text IS NULL OR r.page_id = @pageId)`;
    const [tot] = await q(`SELECT count(*)::int AS received,
            count(*) FILTER (WHERE decision = 'answered')::int AS answered,
            count(*) FILTER (WHERE decision = 'shadow')::int AS shadow,
            count(*) FILTER (WHERE decision = 'escalated')::int AS escalated,
            count(*) FILTER (WHERE decision = 'skipped')::int AS skipped,
            count(*) FILTER (WHERE decision = 'error')::int AS errors,
            count(*) FILTER (WHERE decision = 'skipped' AND (reason LIKE 'already_handled:pos_auto%' OR reason LIKE 'already_handled:botcake%' OR reason LIKE 'pos_rule%'))::int AS pos_handled,
            count(*) FILTER (WHERE decision = 'skipped' AND (reason LIKE 'sale_%' OR reason LIKE 'already_handled:human%' OR reason LIKE 'pause_tag%' OR reason LIKE 'paused%' OR reason LIKE 'handled_during_processing:human%'))::int AS sale_handled,
            COALESCE(sum(input_tokens), 0)::bigint AS input_tokens, COALESCE(sum(output_tokens), 0)::bigint AS output_tokens,
            COALESCE(sum(cost_usd), 0) AS cost_usd, round(avg(duration_ms) FILTER (WHERE decision IN ('answered', 'shadow')))::int AS avg_ms
        FROM ai_bot_runs r WHERE ${where}`, p);
    const daily = await q(`SELECT to_char((r.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day,
            count(*)::int AS received, count(*) FILTER (WHERE decision IN ('answered', 'shadow'))::int AS answered,
            count(*) FILTER (WHERE decision = 'escalated')::int AS escalated, COALESCE(sum(cost_usd), 0) AS cost_usd
        FROM ai_bot_runs r WHERE ${where} GROUP BY 1 ORDER BY 1`, p);
    const intents = await q(`SELECT COALESCE(intent, 'không rõ') AS intent, count(*)::int AS n
        FROM ai_bot_runs r WHERE ${where} AND intent IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`, p);
    const reasons = await q(`SELECT split_part(reason, ':', 1) AS reason, decision, count(*)::int AS n
        FROM ai_bot_runs r WHERE ${where} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`, p);
    const pages = await q(`SELECT r.page_id, COALESCE(pp.name, r.page_id) AS name, r.market, count(*)::int AS received,
            count(*) FILTER (WHERE decision IN ('answered', 'shadow'))::int AS answered,
            count(*) FILTER (WHERE decision = 'escalated')::int AS escalated, COALESCE(sum(r.cost_usd), 0) AS cost_usd
        FROM ai_bot_runs r LEFT JOIN pancake_pages pp ON pp.page_id = r.page_id WHERE ${where}
        GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 50`, p);
    // Chi phí THẬT theo lượt gọi model (cả lượt thử, chạy thử) — chỉ người xem hết (chi phí chung cả công ty).
    const [cost] = scope.full ? await q(`SELECT COALESCE(sum(cost_usd), 0) AS cost_usd, COALESCE(sum(input_tokens + output_tokens), 0)::bigint AS tokens,
            count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed_calls
        FROM ai_bot_provider_calls WHERE created_at >= ((@from::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND created_at < ((@to::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`, p) : [null];
    const [jobs] = await q(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'running')::int AS running,
            count(*) FILTER (WHERE status = 'failed' AND finished_at >= ((@from::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS failed
        FROM ai_bot_jobs j LEFT JOIN pancake_pages pp ON pp.page_id = j.page_id WHERE ${marketCond("pp.market")}`, p);
    const handled = (tot?.answered || 0) + (tot?.shadow || 0);
    const considered = handled + (tot?.escalated || 0);
    return {
        totals: { ...tot, cost_usd: Number(tot?.cost_usd || 0), auto_rate: considered ? handled / considered : null },
        daily: daily.map((d) => ({ ...d, cost_usd: Number(d.cost_usd) })),
        intents, reasons,
        pages: pages.map((x) => ({ ...x, cost_usd: Number(x.cost_usd) })),
        provider_cost: cost ? { ...cost, cost_usd: Number(cost.cost_usd) } : null,
        jobs,
    };
}

// ─── Nhật ký (Logs) ────────────────────────────────────────────────

export async function listRuns(q: QueryFn, scope: Scope, f: {
    decision?: string; reason?: string; pageId?: string; conversationId?: string; from?: string; to?: string; q?: string; page?: unknown; size?: unknown;
}) {
    const size = clampSize(f.size), page = clampPage(f.page);
    const p = {
        full: scope.full, codes: scope.codes, decision: f.decision || null, reason: f.reason ? `${f.reason}%` : null,
        pageId: f.pageId || null, conv: f.conversationId || null, from: f.from || null, to: f.to || null,
        search: f.q ? `%${f.q}%` : null, limit: size, offset: (page - 1) * size,
    };
    const where = `${marketCond("r.market")} AND (@decision::text IS NULL OR r.decision = @decision)
        AND (@reason::text IS NULL OR r.reason LIKE @reason) AND (@pageId::text IS NULL OR r.page_id = @pageId)
        AND (@conv::text IS NULL OR r.conversation_id = @conv)
        AND (@from::text IS NULL OR r.created_at >= ((@from::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AND (@to::text IS NULL OR r.created_at < ((@to::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
        AND (@search::text IS NULL OR unaccent(r.customer_text) ILIKE unaccent(@search) OR unaccent(COALESCE(r.answer, '')) ILIKE unaccent(@search))`;
    const rows = await q(`SELECT r.id, r.created_at, r.page_id, COALESCE(pp.name, r.page_id) AS page_name, r.market, r.conversation_id,
            r.turn_message_id, left(r.customer_text, 300) AS customer_text, r.language, r.intent, r.decision, r.reason,
            left(r.answer, 300) AS answer, r.provider, r.model, r.input_tokens, r.output_tokens, r.cost_usd, r.confidence,
            r.duration_ms, r.mode, r.tag_status
        FROM ai_bot_runs r LEFT JOIN pancake_pages pp ON pp.page_id = r.page_id
        WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT @limit OFFSET @offset`, p);
    const [c] = await q(`SELECT count(*)::int AS n FROM ai_bot_runs r WHERE ${where}`, p);
    return {
        rows: rows.map((r) => ({ ...r, created_at: iso(r.created_at), cost_usd: Number(r.cost_usd), confidence: r.confidence === null ? null : Number(r.confidence) })),
        total: c?.n || 0, page, size,
    };
}

export async function getRun(q: QueryFn, scope: Scope, id: number) {
    const [r] = await q(`SELECT r.*, COALESCE(pp.name, r.page_id) AS page_name FROM ai_bot_runs r
        LEFT JOIN pancake_pages pp ON pp.page_id = r.page_id WHERE r.id = @id AND ${marketCond("r.market")}`,
    { id, full: scope.full, codes: scope.codes });
    if (!r) return null;
    return { ...r, created_at: iso(r.created_at), cost_usd: Number(r.cost_usd), confidence: r.confidence === null ? null : Number(r.confidence) };
}

// ─── Knowledge Base ────────────────────────────────────────────────

export const KB_KINDS: KbKind[] = ["product", "service", "policy", "faq", "page_info", "pos_rule", "document"];
export const KB_SCOPES: KbScope[] = ["global", "market", "page"];

/** Mục KB người xem được (chung: ai cũng thấy; nước: nước của mình; page: page thuộc nước của mình). */
const kbVisible = `(@full OR e.scope = 'global' OR (e.scope = 'market' AND e.market = ANY(@codes))
    OR (e.scope = 'page' AND EXISTS (SELECT 1 FROM pancake_pages pp WHERE pp.page_id = e.page_id AND pp.market = ANY(@codes))))`;

export async function listKb(q: QueryFn, scope: Scope, f: {
    q?: string; kind?: string; source?: string; scope?: string; market?: string; enabled?: string; page?: unknown; size?: unknown;
}) {
    const size = clampSize(f.size), page = clampPage(f.page);
    const p = {
        full: scope.full, codes: scope.codes, search: f.q ? `%${f.q}%` : null, kind: f.kind || null, source: f.source || null,
        sc: f.scope || null, market: f.market || null,
        enabled: f.enabled === "1" ? true : f.enabled === "0" ? false : null, limit: size, offset: (page - 1) * size,
    };
    const where = `e.deleted_at IS NULL AND ${kbVisible} AND (@kind::text IS NULL OR e.kind = @kind)
        AND (@source::text IS NULL OR e.source = @source) AND (@sc::text IS NULL OR e.scope = @sc)
        AND (@market::text IS NULL OR e.market = @market) AND (@enabled::boolean IS NULL OR e.enabled = @enabled)
        AND (@search::text IS NULL OR unaccent(e.title) ILIKE unaccent(@search) OR unaccent(e.content) ILIKE unaccent(@search)
             OR array_to_string(e.keywords, ' ') ILIKE @search)`;
    const rows = await q(`SELECT e.id, e.scope, e.market, e.page_id, e.kind, e.source, e.source_ref, e.is_official, e.title,
            left(e.content, 240) AS content, e.keywords, e.enabled, e.disabled_reason, e.synced_at, e.valid_until, e.updated_at, e.updated_by,
            e.metadata->'variants' AS variants, e.metadata->>'currency' AS currency
        FROM ai_kb_entries e WHERE ${where} ORDER BY e.updated_at DESC, e.id DESC LIMIT @limit OFFSET @offset`, p);
    const [c] = await q(`SELECT count(*)::int AS n FROM ai_kb_entries e WHERE ${where}`, p);
    return {
        rows: rows.map((r) => ({ ...r, synced_at: iso(r.synced_at), valid_until: iso(r.valid_until), updated_at: iso(r.updated_at) })),
        total: c?.n || 0, page, size,
    };
}

export async function getKb(q: QueryFn, scope: Scope, id: number) {
    const [r] = await q(`SELECT e.* FROM ai_kb_entries e WHERE e.id = @id AND e.deleted_at IS NULL AND ${kbVisible}`,
        { id, full: scope.full, codes: scope.codes });
    if (!r) return null;
    const revisions = await q(`SELECT id, action, before, after, actor, at FROM ai_kb_revisions WHERE entry_id = @id ORDER BY at DESC LIMIT 50`, { id });
    return {
        entry: { ...mapKb(r), enabled: r.enabled, disabledReason: r.disabled_reason, sourceRef: r.source_ref,
            createdAt: iso(r.created_at), createdBy: r.created_by, updatedAt: iso(r.updated_at), updatedBy: r.updated_by },
        revisions: revisions.map((x) => ({ ...x, at: iso(x.at) })),
    };
}

export type KbInput = {
    scope: KbScope; market: string | null; page_id: string | null; kind: KbKind; title: string; content: string;
    keywords: string[]; valid_until: string | null; enabled: boolean;
};

/** Kiểm + chuẩn hoá dữ liệu mục KB từ trang. Lỗi → danh sách lỗi tiếng Việt. */
export function parseKbInput(b: any): { ok: true; value: KbInput } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    const scopeV = String(b?.scope || "global");
    const kind = String(b?.kind || "faq");
    const title = String(b?.title || "").trim();
    const content = String(b?.content || "").trim();
    if (!KB_SCOPES.includes(scopeV as KbScope)) errors.push("Phạm vi phải là chung / nước / page");
    if (!KB_KINDS.includes(kind as KbKind) || kind === "product") errors.push("Loại không hợp lệ (sản phẩm chỉ đến từ đồng bộ POS)");
    if (title.length < 3 || title.length > 300) errors.push("Tiêu đề 3–300 ký tự");
    if (content.length < 3 || content.length > 8000) errors.push("Nội dung 3–8000 ký tự");
    const market = scopeV === "market" ? String(b?.market || "").trim().toUpperCase() : null;
    const pageId = scopeV === "page" ? String(b?.page_id || "").trim() : null;
    if (scopeV === "market" && !/^[A-Z]{2,4}$/.test(market || "")) errors.push("Chọn nước");
    if (scopeV === "page" && !/^[\w.:-]{1,80}$/.test(pageId || "")) errors.push("Chọn page");
    const keywords = (Array.isArray(b?.keywords) ? b.keywords : String(b?.keywords || "").split(","))
        .map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 30);
    let validUntil: string | null = null;
    if (b?.valid_until) {
        const t = Date.parse(String(b.valid_until));
        if (Number.isNaN(t)) errors.push("Ngày hết hiệu lực không hợp lệ"); else validUntil = new Date(t).toISOString();
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: { scope: scopeV as KbScope, market, page_id: pageId, kind: kind as KbKind, title, content, keywords,
        valid_until: validUntil, enabled: b?.enabled !== false } };
}

/** Người này được ghi mục KB có phạm vi này không: chung → chỉ người xem hết; nước / page → nước của mình. */
export async function canWriteKbScope(q: QueryFn, scope: Scope, v: { scope: string; market: string | null; page_id: string | null }): Promise<boolean> {
    if (scope.full) return true;
    if (v.scope === "market") return !!v.market && scope.codes.includes(v.market);
    if (v.scope === "page") {
        const [r] = await q(`SELECT market FROM pancake_pages WHERE page_id = @pageId`, { pageId: v.page_id });
        return !!r?.market && scope.codes.includes(r.market);
    }
    return false;
}

const kbSnapshot = (r: any) => r ? { scope: r.scope, market: r.market, page_id: r.page_id, kind: r.kind, title: r.title, content: r.content,
    keywords: r.keywords, enabled: r.enabled, valid_until: iso(r.valid_until) } : null;

export async function createKb(q: QueryFn, scope: Scope, v: KbInput, source: "admin" | "learning" = "admin") {
    const [r] = await q(`INSERT INTO ai_kb_entries (scope, market, page_id, kind, source, is_official, title, content, keywords, valid_until,
            enabled, created_by, updated_by)
        VALUES (@scope, @market, @pageId, @kind, @source, false, @title, @content, @keywords, @validUntil, @enabled, @actor, @actor) RETURNING *`,
    { scope: v.scope, market: v.market, pageId: v.page_id, kind: v.kind, source, title: v.title, content: v.content,
        keywords: v.keywords, validUntil: v.valid_until, enabled: v.enabled, actor: scope.actor });
    await q(`INSERT INTO ai_kb_revisions (entry_id, action, after, actor) VALUES (@id, 'create', @after::jsonb, @actor)`,
        { id: r.id, after: JSON.stringify(kbSnapshot(r)), actor: scope.actor });
    return Number(r.id);
}

export async function updateKb(q: QueryFn, scope: Scope, id: number, v: KbInput): Promise<"ok" | "not_found" | "official"> {
    const [cur] = await q(`SELECT * FROM ai_kb_entries WHERE id = @id AND deleted_at IS NULL`, { id });
    if (!cur) return "not_found";
    if (cur.source === "pos_sync") return "official";
    const [r] = await q(`UPDATE ai_kb_entries SET scope = @scope, market = @market, page_id = @pageId, kind = @kind, title = @title,
            content = @content, keywords = @keywords, valid_until = @validUntil, enabled = @enabled, disabled_reason = NULL,
            updated_at = now(), updated_by = @actor
        WHERE id = @id RETURNING *`,
    { id, scope: v.scope, market: v.market, pageId: v.page_id, kind: v.kind, title: v.title, content: v.content,
        keywords: v.keywords, validUntil: v.valid_until, enabled: v.enabled, actor: scope.actor });
    await q(`INSERT INTO ai_kb_revisions (entry_id, action, before, after, actor) VALUES (@id, 'update', @before::jsonb, @after::jsonb, @actor)`,
        { id, before: JSON.stringify(kbSnapshot(cur)), after: JSON.stringify(kbSnapshot(r)), actor: scope.actor });
    return "ok";
}

export async function setKbEnabled(q: QueryFn, scope: Scope, id: number, enabled: boolean) {
    const r = await q(`UPDATE ai_kb_entries SET enabled = @enabled, disabled_reason = CASE WHEN @enabled THEN NULL ELSE 'admin' END,
        updated_at = now(), updated_by = @actor WHERE id = @id AND deleted_at IS NULL RETURNING id`, { id, enabled, actor: scope.actor });
    if (r.length) await q(`INSERT INTO ai_kb_revisions (entry_id, action, actor) VALUES (@id, @action, @actor)`,
        { id, action: enabled ? "enable" : "disable", actor: scope.actor });
    return r.length > 0;
}

/** Xoá MỀM (deleted_at) — lịch sử giữ, khôi phục được bằng SQL. Mục đồng bộ POS không xoá (chỉ tắt). */
export async function deleteKb(q: QueryFn, scope: Scope, id: number): Promise<"ok" | "not_found" | "official"> {
    const [cur] = await q(`SELECT * FROM ai_kb_entries WHERE id = @id AND deleted_at IS NULL`, { id });
    if (!cur) return "not_found";
    if (cur.source === "pos_sync") return "official";
    await q(`UPDATE ai_kb_entries SET deleted_at = now(), enabled = false, updated_at = now(), updated_by = @actor WHERE id = @id`, { id, actor: scope.actor });
    await q(`INSERT INTO ai_kb_revisions (entry_id, action, before, actor) VALUES (@id, 'delete', @before::jsonb, @actor)`,
        { id, before: JSON.stringify(kbSnapshot(cur)), actor: scope.actor });
    return "ok";
}

export async function kbEntryScope(q: QueryFn, id: number) {
    const [r] = await q(`SELECT scope, market, page_id, source FROM ai_kb_entries WHERE id = @id AND deleted_at IS NULL`, { id });
    return r ? { scope: r.scope as string, market: r.market as string | null, page_id: r.page_id as string | null, source: r.source as string } : null;
}

// ─── AI Learning ───────────────────────────────────────────────────

export async function listLearning(q: QueryFn, scope: Scope, f: { status?: string; q?: string; page?: unknown; size?: unknown }) {
    const size = clampSize(f.size), page = clampPage(f.page);
    const p = { full: scope.full, codes: scope.codes, status: f.status || null, search: f.q ? `%${f.q}%` : null, limit: size, offset: (page - 1) * size };
    const where = `${marketCond("l.market")} AND (@status::text IS NULL OR l.status = @status)
        AND (@search::text IS NULL OR unaccent(l.sample_text) ILIKE unaccent(@search))`;
    const rows = await q(`SELECT l.id, l.market, l.page_id, COALESCE(pp.name, l.page_id) AS page_name, l.sample_text, l.intent, l.language,
            l.reason, l.occurrences, l.status, left(l.answer, 300) AS answer, l.kb_entry_id, l.handled_by, l.handled_at,
            l.first_seen_at, l.last_seen_at
        FROM ai_learning_questions l LEFT JOIN pancake_pages pp ON pp.page_id = l.page_id
        WHERE ${where} ORDER BY (l.status = 'pending') DESC, l.occurrences DESC, l.last_seen_at DESC LIMIT @limit OFFSET @offset`, p);
    const [c] = await q(`SELECT count(*)::int AS n FROM ai_learning_questions l WHERE ${where}`, p);
    const counts = await q(`SELECT status, count(*)::int AS n FROM ai_learning_questions l WHERE ${marketCond("l.market")} GROUP BY 1`, p);
    return {
        rows: rows.map((r) => ({ ...r, handled_at: iso(r.handled_at), first_seen_at: iso(r.first_seen_at), last_seen_at: iso(r.last_seen_at) })),
        total: c?.n || 0, page, size, counts: Object.fromEntries(counts.map((x) => [x.status, x.n])),
    };
}

export async function getLearning(q: QueryFn, scope: Scope, id: number) {
    const [r] = await q(`SELECT l.*, COALESCE(pp.name, l.page_id) AS page_name FROM ai_learning_questions l
        LEFT JOIN pancake_pages pp ON pp.page_id = l.page_id WHERE l.id = @id AND ${marketCond("l.market")}`,
    { id, full: scope.full, codes: scope.codes });
    if (!r) return null;
    const occurrences = await q(`SELECT o.page_id, o.conversation_id, o.message_id, o.text, o.reason, o.at,
            (SELECT left(customer_text, 600) FROM ai_bot_runs ru WHERE ru.page_id = o.page_id AND ru.conversation_id = o.conversation_id
             AND ru.turn_message_id = o.message_id LIMIT 1) AS customer_text
        FROM ai_learning_occurrences o WHERE o.question_id = @id ORDER BY o.at DESC LIMIT 30`, { id });
    const history = await q(`SELECT action, detail, actor, at FROM ai_learning_history WHERE question_id = @id ORDER BY at DESC LIMIT 30`, { id });
    return {
        question: { ...r, handled_at: iso(r.handled_at), first_seen_at: iso(r.first_seen_at), last_seen_at: iso(r.last_seen_at) },
        occurrences: occurrences.map((o) => ({ ...o, at: iso(o.at) })),
        history: history.map((h) => ({ ...h, at: iso(h.at) })),
    };
}

export async function setLearningStatus(q: QueryFn, scope: Scope, id: number, to: LearningStatus): Promise<"ok" | "not_found" | "invalid"> {
    const [cur] = await q(`SELECT status FROM ai_learning_questions WHERE id = @id`, { id });
    if (!cur) return "not_found";
    if (to === "approved" || !canTransition(cur.status, to)) return "invalid";
    await q(`UPDATE ai_learning_questions SET status = @to, handled_by = @actor, handled_at = now() WHERE id = @id`, { id, to, actor: scope.actor });
    await q(`INSERT INTO ai_learning_history (question_id, action, detail, actor) VALUES (@id, @action, @detail::jsonb, @actor)`,
        { id, action: `status:${to}`, detail: JSON.stringify({ from: cur.status }), actor: scope.actor });
    return "ok";
}

/**
 * Duyệt câu trả lời chuẩn → mục FAQ (source = learning) → nhóm "approved". Câu tương tự về sau AI tìm thấy FAQ này.
 * Phạm vi FAQ: theo nước của nhóm câu hỏi (không có nước → chung, chỉ người xem hết duyệt được).
 */
export async function approveLearning(q: QueryFn, scope: Scope, id: number, answer: string, question?: string): Promise<{ ok: true; kbId: number } | { ok: false; error: string }> {
    const a = String(answer || "").trim();
    if (a.length < 3 || a.length > 4000) return { ok: false, error: "Câu trả lời 3–4000 ký tự" };
    const [cur] = await q(`SELECT * FROM ai_learning_questions WHERE id = @id`, { id });
    if (!cur) return { ok: false, error: "Không có câu hỏi này" };
    if (!canTransition(cur.status, "approved")) return { ok: false, error: "Câu hỏi đã duyệt / bỏ qua — mở lại trước khi duyệt" };
    const kbScope = cur.market ? "market" : "global";
    if (!(await canWriteKbScope(q, scope, { scope: kbScope, market: cur.market, page_id: null }))) {
        return { ok: false, error: "Không được ghi kiến thức cho phạm vi này" };
    }
    const samples = await q(`SELECT text FROM ai_learning_occurrences WHERE question_id = @id ORDER BY at DESC LIMIT 20`, { id });
    const title = (String(question || "").trim() || cur.sample_text).slice(0, 300);
    const kbId = await createKb(q, scope, {
        scope: kbScope, market: cur.market, page_id: null, kind: "faq", title,
        content: `Hỏi: ${title}\nTrả lời: ${a}`, keywords: faqKeywords([cur.sample_text, ...samples.map((s) => s.text)]),
        valid_until: null, enabled: true,
    }, "learning");
    await q(`UPDATE ai_learning_questions SET status = 'approved', answer = @answer, kb_entry_id = @kbId, handled_by = @actor, handled_at = now() WHERE id = @id`,
        { id, answer: a, kbId, actor: scope.actor });
    await q(`INSERT INTO ai_learning_history (question_id, action, detail, actor) VALUES (@id, 'approve', @detail::jsonb, @actor)`,
        { id, detail: JSON.stringify({ kb_entry_id: kbId, answer: a.slice(0, 500) }), actor: scope.actor });
    return { ok: true, kbId };
}

/** Lưu nháp câu trả lời (chưa duyệt) — trạng thái "đang xử lý". */
export async function draftLearning(q: QueryFn, scope: Scope, id: number, answer: string) {
    const r = await q(`UPDATE ai_learning_questions SET answer = @answer, status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END,
        handled_by = @actor, handled_at = now() WHERE id = @id AND status IN ('pending', 'processing') RETURNING id`,
    { id, answer: String(answer || "").slice(0, 4000), actor: scope.actor });
    if (r.length) await q(`INSERT INTO ai_learning_history (question_id, action, detail, actor) VALUES (@id, 'answer', @detail::jsonb, @actor)`,
        { id, detail: JSON.stringify({ answer: String(answer || "").slice(0, 500) }), actor: scope.actor });
    return r.length > 0;
}

export async function learningMarket(q: QueryFn, id: number): Promise<string | null | undefined> {
    const [r] = await q(`SELECT market FROM ai_learning_questions WHERE id = @id`, { id });
    return r ? r.market : undefined;
}

// ─── Page + luật POS + trạng thái hội thoại ───────────────────────

export async function listPages(q: QueryFn, scope: Scope) {
    const rows = await q(`SELECT p.page_id, p.name, p.market, p.last_error_code, COALESCE(a.enabled, false) AS enabled, a.last_poll_at,
            a.last_error AS poll_error, a.note
        FROM pancake_pages p LEFT JOIN ai_bot_pages a ON a.page_id = p.page_id
        WHERE ${marketCond("p.market")} ORDER BY COALESCE(a.enabled, false) DESC, p.market NULLS LAST, p.name`,
    { full: scope.full, codes: scope.codes });
    return rows.map((r) => ({ ...r, last_poll_at: iso(r.last_poll_at) }));
}

/** Chế độ AI của page: auto (mặc định — tự chạy khi đủ điều kiện) / on (luôn bật) / off (tắt). Cột enabled giữ cho bản cũ. */
export async function setPageMode(q: QueryFn, scope: Scope, pageId: string, mode: "auto" | "on" | "off", note?: string | null) {
    await q(`INSERT INTO ai_bot_pages (page_id, mode, enabled, note, updated_by) VALUES (@pageId, @mode, @mode = 'on', @note, @actor)
        ON CONFLICT (page_id) DO UPDATE SET mode = EXCLUDED.mode, enabled = EXCLUDED.enabled, note = COALESCE(EXCLUDED.note, ai_bot_pages.note),
        updated_at = now(), updated_by = EXCLUDED.updated_by`, { pageId, mode, note: note ?? null, actor: scope.actor });
}

export async function listPosRules(q: QueryFn) {
    const rows = await q(`SELECT r.*, COALESCE(pp.name, r.page_id) AS page_name FROM ai_bot_pos_rules r
        LEFT JOIN pancake_pages pp ON pp.page_id = r.page_id ORDER BY r.id`);
    return rows.map((r) => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
}

export function parsePosRule(b: any): { ok: true; value: { page_id: string | null; kind: string; pattern: string; note: string | null; enabled: boolean } } | { ok: false; error: string } {
    const kind = String(b?.kind || "");
    const pattern = String(b?.pattern || "").trim();
    if (!["first_message", "keyword", "regex", "intent"].includes(kind)) return { ok: false, error: "Loại luật không hợp lệ" };
    if (kind !== "first_message" && !pattern) return { ok: false, error: "Nhập từ khoá / mẫu / ý định" };
    if (kind === "regex" && !validRegex(pattern)) return { ok: false, error: "Biểu thức regex không hợp lệ (hoặc dài quá 300 ký tự)" };
    if (pattern.length > 1000) return { ok: false, error: "Mẫu quá dài" };
    const pageId = b?.page_id ? String(b.page_id).trim() : null;
    if (pageId && !/^[\w.:-]{1,80}$/.test(pageId)) return { ok: false, error: "Page không hợp lệ" };
    return { ok: true, value: { page_id: pageId, kind, pattern, note: b?.note ? String(b.note).slice(0, 300) : null, enabled: b?.enabled !== false } };
}

export async function savePosRule(q: QueryFn, scope: Scope, id: number | null, v: { page_id: string | null; kind: string; pattern: string; note: string | null; enabled: boolean }) {
    if (id) {
        const r = await q(`UPDATE ai_bot_pos_rules SET page_id = @pageId, kind = @kind, pattern = @pattern, note = @note, enabled = @enabled,
            updated_at = now(), updated_by = @actor WHERE id = @id RETURNING id`, { id, pageId: v.page_id, kind: v.kind, pattern: v.pattern, note: v.note, enabled: v.enabled, actor: scope.actor });
        return r.length ? id : null;
    }
    const [r] = await q(`INSERT INTO ai_bot_pos_rules (page_id, kind, pattern, note, enabled, created_by, updated_by)
        VALUES (@pageId, @kind, @pattern, @note, @enabled, @actor, @actor) RETURNING id`,
    { pageId: v.page_id, kind: v.kind, pattern: v.pattern, note: v.note, enabled: v.enabled, actor: scope.actor });
    return Number(r.id);
}

/** Tạm dừng / bật lại AI ở một hội thoại (Sale tiếp nhận thủ công). minutes = 0 → bật lại. */
export async function pauseConversation(q: QueryFn, scope: Scope, pageId: string, conversationId: string, minutes: number) {
    await q(`INSERT INTO ai_bot_conversation_state (page_id, conversation_id, paused_until, paused_reason, paused_by, updated_at)
        VALUES (@pageId, @conv, CASE WHEN @minutes > 0 THEN now() + make_interval(mins => @minutes) ELSE NULL END, CASE WHEN @minutes > 0 THEN 'manual' ELSE NULL END, @actor, now())
        ON CONFLICT (page_id, conversation_id) DO UPDATE SET paused_until = EXCLUDED.paused_until, paused_reason = EXCLUDED.paused_reason,
        paused_by = EXCLUDED.paused_by, updated_at = now()`, { pageId, conv: conversationId, minutes: Math.max(0, Math.round(minutes)), actor: scope.actor });
}

export async function getSettingsOverride(q: QueryFn) {
    const [r] = await q(`SELECT settings, updated_at, updated_by FROM ai_bot_settings WHERE id = 1`);
    return r ? { settings: r.settings || {}, updated_at: iso(r.updated_at), updated_by: r.updated_by } : { settings: {}, updated_at: null, updated_by: null };
}

export async function saveSettingsOverride(q: QueryFn, scope: Scope, settings: Record<string, unknown>) {
    await q(`INSERT INTO ai_bot_settings (id, settings, updated_at, updated_by) VALUES (1, @settings::jsonb, now(), @actor)
        ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    { settings: JSON.stringify(settings), actor: scope.actor });
}

export async function logWebhook(q: QueryFn, w: { ip: string | null; ok: boolean; error: string | null; eventType: string | null; pageId: string | null; conversationId: string | null; payload: unknown }) {
    await q(`INSERT INTO ai_bot_webhook_log (remote_ip, ok, error, event_type, page_id, conversation_id, payload)
        VALUES (@ip, @ok, @error, @eventType, @pageId, @conversationId, @payload::jsonb)`,
    { ...w, payload: compactJson(w.payload, 8000) });
}

/** JSON để lưu, tối đa `max` ký tự — dài hơn thì lưu {truncated, head} (cắt giữa chuỗi JSON là JSON hỏng). */
export function compactJson(v: unknown, max: number): string {
    const s = JSON.stringify(v ?? null) ?? "null";
    return s.length <= max ? s : JSON.stringify({ truncated: true, length: s.length, head: s.slice(0, Math.floor(max / 2)) });
}
