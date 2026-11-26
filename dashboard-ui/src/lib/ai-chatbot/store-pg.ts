// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — kho Postgres cho Router + hàng đợi + khoá thuê (migration 0009). Hàm `query` TIÊM VÀO (lib/db.ts ở máy
// chủ, pool riêng ở test tích hợp) — file không import "@/…" để test biên dịch được.
//
// Mọi lệnh ghi là MỘT câu ngắn (không giữ transaction khi chờ AI / Pancake). Chống trùng bằng UNIQUE + ON CONFLICT:
//   • ai_bot_runs (lượt khách) · ai_bot_outbox (lượt gửi) · ai_bot_notifications (lượt báo) · job chờ / hội thoại.
// Claim job: FOR UPDATE SKIP LOCKED; không claim job của hội thoại đang có job chạy. Khoá hội thoại: thuê có hạn.
// ═══════════════════════════════════════════════════════════════════
import type {
    ConversationState, Decision, KbEntry, PageConfig, PosRule, RouterStore, RunInput, UnansweredInput,
} from "./types";
import { findSimilarQuestion, questionSignature } from "./learning";
import { resolvePage, type PageFacts, type PageMode, type PagePolicy, type PageStatus } from "./page-policy";

export type QueryFn = <T = any>(sql: string, params?: Record<string, unknown>) => Promise<T[]>;

/** timestamptz đọc ra: chuỗi ISO (lib/db.ts) hoặc Date (pg trần) → ms. */
export const toMs = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
    return Number.isNaN(t) ? null : t;
};
const iso = (ms: number) => new Date(ms).toISOString();
const json = (v: unknown) => JSON.stringify(v ?? null);

export type Job = {
    id: number; pageId: string; conversationId: string; status: string; source: string | null;
    runAfter: number; attempts: number; lockedBy: string | null;
};

const mapJob = (r: any): Job => ({
    id: Number(r.id), pageId: r.page_id, conversationId: r.conversation_id, status: r.status, source: r.source,
    runAfter: toMs(r.run_after) ?? 0, attempts: Number(r.attempts), lockedBy: r.locked_by,
});

export const mapKb = (r: any): KbEntry => ({
    id: Number(r.id), scope: r.scope, market: r.market, pageId: r.page_id, kind: r.kind, source: r.source,
    isOfficial: !!r.is_official, title: r.title, content: r.content || "", keywords: r.keywords || [],
    metadata: r.metadata || {}, syncedAt: toMs(r.synced_at), validUntil: toMs(r.valid_until),
});

export type PgStoreOptions = {
    /** Page có token page (gửi được) — đọc bảng khoá kết nối. */
    hasPageToken: (pageId: string) => boolean;
    /** Biến khoá token tài khoản Pancake (pancake_pages.token_var) đang có giá trị. Không truyền → coi như không. */
    hasAccountToken?: (tokenVar: string | null) => boolean;
    /** Luật page tự động (cài đặt hiện tại). Không truyền → chỉ page "Luôn bật" chạy. */
    policy?: () => Omit<PagePolicy, "now">;
    kbCacheMs?: number;
    now?: () => number;
};

/** Dòng pancake_pages ⟕ ai_bot_pages → dữ kiện cho luật page. */
const PAGE_SQL = `SELECT p.page_id, COALESCE(p.name, '') AS name, p.market, p.token_var, p.last_error_code,
        COALESCE(a.mode, 'auto') AS mode, a.health, a.health_code, a.health_detail, a.health_at, a.other_bot_at, a.poll_cursor,
        a.last_poll_at, a.last_error, a.alerted_at, a.note
    FROM pancake_pages p LEFT JOIN ai_bot_pages a ON a.page_id = p.page_id`;

export type PageRow = {
    pageId: string; name: string; market: string | null; mode: PageMode; enabled: boolean; status: PageStatus;
    hasPageToken: boolean; hasAccountToken: boolean; health: string | null; healthCode: string | null; healthDetail: string | null;
    healthAt: number | null; otherBotAt: number | null; pollCursor: number | null; lastPollAt: number | null; alertedAt: number | null;
    inboxErrorCode: string | null; note: string | null;
};

export function createPgStore(q: QueryFn, o: PgStoreOptions) {
    const kbCache = new Map<string, { at: number; rows: KbEntry[] }>();
    const kbCacheMs = o.kbCacheMs ?? 30_000;
    const now = o.now || Date.now;

    const toPageRow = (r: any): PageRow => {
        const facts: PageFacts = {
            mode: (r.mode || "auto") as PageMode, market: r.market || null, inboxErrorCode: r.last_error_code || null,
            hasPageToken: o.hasPageToken(r.page_id), hasAccountToken: o.hasAccountToken ? o.hasAccountToken(r.token_var || null) : false,
            health: r.health || null, healthCode: r.health_code || null, healthAt: toMs(r.health_at), otherBotAt: toMs(r.other_bot_at),
        };
        const pol = o.policy ? o.policy() : { pagesAuto: false, live: false, otherBotQuietMs: 24 * 3600_000, errorBackoffMs: 30 * 60_000 };
        const res = resolvePage(facts, { ...pol, now: now() });
        return {
            pageId: r.page_id, name: r.name || r.page_id, market: facts.market, mode: facts.mode, enabled: res.enabled, status: res.status,
            hasPageToken: facts.hasPageToken, hasAccountToken: facts.hasAccountToken, health: facts.health, healthCode: facts.healthCode,
            healthDetail: r.health_detail || null, healthAt: facts.healthAt, otherBotAt: facts.otherBotAt, pollCursor: toMs(r.poll_cursor),
            lastPollAt: toMs(r.last_poll_at), alertedAt: toMs(r.alerted_at), inboxErrorCode: facts.inboxErrorCode, note: r.note || null,
        };
    };

    const store: RouterStore & Record<string, unknown> = {
        /** Page + "có được xét không" theo luật page tự động (page-policy.ts). Page không có trong hộp thư → null. */
        async getPage(pageId: string): Promise<PageConfig | null> {
            const [r] = await q(`${PAGE_SQL} WHERE p.page_id = @pageId`, { pageId });
            if (!r) return null;
            const p = toPageRow(r);
            return { pageId: p.pageId, name: p.name, market: p.market, enabled: p.enabled, canSend: p.hasPageToken };
        },

        async getRunForTurn(pageId: string, conversationId: string, turnMessageId: string) {
            const [r] = await q(`SELECT id, decision FROM ai_bot_runs WHERE page_id = @pageId AND conversation_id = @conversationId
                AND turn_message_id = @turnMessageId`, { pageId, conversationId, turnMessageId });
            return r ? { id: Number(r.id), decision: r.decision as Decision } : null;
        },

        async insertRun(run: RunInput): Promise<number | null> {
            const [r] = await q(`INSERT INTO ai_bot_runs (job_id, page_id, conversation_id, turn_message_id, market, customer_text,
                    language, intent, classification, retrieved, answer, decision, reason, provider, model, input_tokens,
                    output_tokens, cost_usd, confidence, duration_ms, sent_message_id, tag_status, mode, trace)
                VALUES (@jobId, @pageId, @conversationId, @turnMessageId, @market, @customerText, @language, @intent,
                    @classification::jsonb, @retrieved::jsonb, @answer, @decision, @reason, @provider, @model, @inputTokens,
                    @outputTokens, @costUsd, @confidence, @durationMs, @sentMessageId, @tagStatus, @mode, @trace::jsonb)
                ON CONFLICT (page_id, conversation_id, turn_message_id) DO NOTHING RETURNING id`, {
                jobId: run.jobId, pageId: run.pageId, conversationId: run.conversationId, turnMessageId: run.turnMessageId,
                market: run.market, customerText: run.customerText, language: run.language, intent: run.intent,
                classification: json(run.classification), retrieved: json(run.retrieved), answer: run.answer,
                decision: run.decision, reason: run.reason.slice(0, 300), provider: run.provider, model: run.model,
                inputTokens: Math.round(run.inputTokens), outputTokens: Math.round(run.outputTokens), costUsd: run.costUsd,
                confidence: run.confidence, durationMs: Math.round(run.durationMs), sentMessageId: run.sentMessageId,
                tagStatus: run.tagStatus, mode: run.mode, trace: json(run.trace),
            });
            return r ? Number(r.id) : null;
        },

        async getConversationState(pageId: string, conversationId: string): Promise<ConversationState | null> {
            const [r] = await q(`SELECT * FROM ai_bot_conversation_state WHERE page_id = @pageId AND conversation_id = @conversationId`,
                { pageId, conversationId });
            if (!r) return null;
            return {
                pageId, conversationId, pausedUntil: toMs(r.paused_until), pausedReason: r.paused_reason, language: r.language,
                lastProducts: Array.isArray(r.last_products) ? r.last_products.map(Number) : [], lastIntent: r.last_intent,
                lastAiReplyAt: toMs(r.last_ai_reply_at),
            };
        },

        // KHÔNG ghi cột tạm dừng — Sale bấm "tạm dừng" trong lúc AI đang lưu trạng thái thì lệnh đó không bị đè.
        async saveConversationState(s: ConversationState) {
            await q(`INSERT INTO ai_bot_conversation_state (page_id, conversation_id, language, last_products, last_intent, last_ai_reply_at, updated_at)
                VALUES (@pageId, @conversationId, @language, @lastProducts::jsonb, @lastIntent, @lastAiReplyAt, now())
                ON CONFLICT (page_id, conversation_id) DO UPDATE SET language = EXCLUDED.language, last_products = EXCLUDED.last_products,
                    last_intent = EXCLUDED.last_intent, last_ai_reply_at = EXCLUDED.last_ai_reply_at, updated_at = now()`, {
                pageId: s.pageId, conversationId: s.conversationId, language: s.language,
                lastProducts: json(s.lastProducts.slice(0, 10)), lastIntent: s.lastIntent,
                lastAiReplyAt: s.lastAiReplyAt ? iso(s.lastAiReplyAt) : null,
            });
        },

        /** Tạm dừng — chỉ kéo DÀI (lệnh tạm dừng dài hơn của Sale không bị rút ngắn). */
        async pauseConversation(pageId: string, conversationId: string, untilMs: number, reason: string) {
            await q(`INSERT INTO ai_bot_conversation_state (page_id, conversation_id, paused_until, paused_reason, updated_at)
                VALUES (@pageId, @conversationId, @until, @reason, now())
                ON CONFLICT (page_id, conversation_id) DO UPDATE SET
                    paused_reason = CASE WHEN ai_bot_conversation_state.paused_until IS NULL OR ai_bot_conversation_state.paused_until < EXCLUDED.paused_until
                        THEN EXCLUDED.paused_reason ELSE ai_bot_conversation_state.paused_reason END,
                    paused_until = GREATEST(ai_bot_conversation_state.paused_until, EXCLUDED.paused_until), updated_at = now()`,
            { pageId, conversationId, until: iso(untilMs), reason });
        },

        async getOutbox(pageId: string, conversationId: string, turnMessageId: string) {
            const [r] = await q(`SELECT status, updated_at, text FROM ai_bot_outbox WHERE page_id = @pageId AND conversation_id = @conversationId
                AND turn_message_id = @turnMessageId`, { pageId, conversationId, turnMessageId });
            return r ? { status: String(r.status), updatedAt: toMs(r.updated_at) ?? 0, text: String(r.text || "") } : null;
        },

        async isAssignedOnDashboard(pageId: string, conversationId: string) {
            const r = await q(`SELECT 1 FROM inbox_assignments WHERE page_id = @pageId AND conversation_id = @conversationId`,
                { pageId, conversationId });
            return r.length > 0;
        },

        async countAiRepliesSince(pageId: string, conversationId: string, sinceMs: number) {
            const [r] = await q(`SELECT count(*)::int AS n FROM ai_bot_runs WHERE page_id = @pageId AND conversation_id = @conversationId
                AND decision = 'answered' AND created_at >= @since`, { pageId, conversationId, since: iso(sinceMs) });
            return Number(r?.n || 0);
        },

        async lastPageSendAt(pageId: string) {
            const [r] = await q(`SELECT max(updated_at) AS t FROM ai_bot_outbox WHERE page_id = @pageId AND status = 'sent'`, { pageId });
            return toMs(r?.t);
        },

        async costSince(sinceMs: number) {
            const [r] = await q(`SELECT COALESCE(sum(cost_usd), 0) AS c FROM ai_bot_provider_calls WHERE created_at >= @since`, { since: iso(sinceMs) });
            return Number(r?.c || 0);
        },

        async listPosRules(pageId: string): Promise<PosRule[]> {
            const rows = await q(`SELECT id, page_id, kind, pattern, enabled, note FROM ai_bot_pos_rules
                WHERE page_id IS NULL OR page_id = @pageId ORDER BY id`, { pageId });
            return rows.map((r) => ({ id: Number(r.id), pageId: r.page_id, kind: r.kind, pattern: r.pattern || "", enabled: !!r.enabled, note: r.note }));
        },

        async knowledgeCandidates(scope: { pageId: string; market: string | null }): Promise<KbEntry[]> {
            const key = `${scope.pageId}|${scope.market || ""}`;
            const c = kbCache.get(key);
            if (c && now() - c.at < kbCacheMs) return c.rows;
            const rows = await q(`SELECT id, scope, market, page_id, kind, source, is_official, title, left(content, 4000) AS content,
                    keywords, metadata, synced_at, valid_until
                FROM ai_kb_entries
                WHERE enabled AND deleted_at IS NULL AND (valid_until IS NULL OR valid_until > now())
                  AND (scope = 'global' OR (scope = 'market' AND market = @market) OR (scope = 'page' AND page_id = @pageId))
                ORDER BY id LIMIT 3000`, { pageId: scope.pageId, market: scope.market || "" });
            const out = rows.map(mapKb);
            kbCache.set(key, { at: now(), rows: out });
            return out;
        },

        async ownSentTexts(pageId: string, conversationId: string) {
            const rows = await q(`SELECT text FROM ai_bot_outbox WHERE page_id = @pageId AND conversation_id = @conversationId AND status = 'sent'`,
                { pageId, conversationId });
            return new Set(rows.map((r) => String(r.text || "").replace(/\s+/g, " ").trim()));
        },

        async markOtherBot(pageId: string) {
            await q(`INSERT INTO ai_bot_pages (page_id, other_bot_at) VALUES (@pageId, now())
                ON CONFLICT (page_id) DO UPDATE SET other_bot_at = now()`, { pageId });
        },

        async ownSentMessageIds(pageId: string, conversationId: string) {
            const rows = await q(`SELECT pancake_message_id FROM ai_bot_outbox WHERE page_id = @pageId AND conversation_id = @conversationId
                AND pancake_message_id IS NOT NULL`, { pageId, conversationId });
            return new Set(rows.map((r) => String(r.pancake_message_id)));
        },

        async reserveOutbox(pageId: string, conversationId: string, turnMessageId: string, text: string) {
            const r = await q(`INSERT INTO ai_bot_outbox (page_id, conversation_id, turn_message_id, text)
                VALUES (@pageId, @conversationId, @turnMessageId, @text) ON CONFLICT DO NOTHING RETURNING 1 AS ok`,
            { pageId, conversationId, turnMessageId, text });
            return r.length > 0;
        },

        async finishOutbox(pageId: string, conversationId: string, turnMessageId: string, status: "sent" | "failed" | "unknown",
            pancakeMessageId?: string | null, error?: string | null) {
            await q(`UPDATE ai_bot_outbox SET status = @status, pancake_message_id = @mid, error = @error, updated_at = now()
                WHERE page_id = @pageId AND conversation_id = @conversationId AND turn_message_id = @turnMessageId`,
            { pageId, conversationId, turnMessageId, status, mid: pancakeMessageId ?? null, error: error ? error.slice(0, 500) : null });
        },

        async recordUnanswered(u: UnansweredInput) {
            const sig = questionSignature(u.text);
            if (!sig.normalized) return;
            const cands = await q(`SELECT id, normalized, tokens FROM ai_learning_questions
                WHERE status IN ('pending', 'processing') AND market IS NOT DISTINCT FROM @market
                ORDER BY last_seen_at DESC LIMIT 500`, { market: u.market });
            let id = findSimilarQuestion(cands.map((c) => ({ id: Number(c.id), normalized: c.normalized, tokens: c.tokens || [] })), sig);
            if (id === null) {
                const [r] = await q(`INSERT INTO ai_learning_questions (market, page_id, sample_text, normalized, tokens, intent, language, reason, occurrences)
                    VALUES (@market, @pageId, @text, @normalized, @tokens, @intent, @language, @reason, 0) RETURNING id`, {
                    market: u.market, pageId: u.pageId, text: u.text, normalized: sig.normalized, tokens: sig.tokens,
                    intent: u.intent, language: u.language, reason: u.reason,
                });
                id = Number(r.id);
            }
            const ins = await q(`INSERT INTO ai_learning_occurrences (question_id, page_id, conversation_id, message_id, text, reason)
                VALUES (@id, @pageId, @conversationId, @messageId, @text, @reason) ON CONFLICT DO NOTHING RETURNING id`, {
                id, pageId: u.pageId, conversationId: u.conversationId, messageId: u.messageId, text: u.text, reason: u.reason,
            });
            if (ins.length) {
                await q(`UPDATE ai_learning_questions SET occurrences = occurrences + 1, last_seen_at = now(),
                    reason = COALESCE(@reason, reason) WHERE id = @id`, { id, reason: u.reason });
            }
        },

        async reserveNotification(dedupKey: string, payload: unknown) {
            const r = await q(`INSERT INTO ai_bot_notifications (dedup_key, payload) VALUES (@dedupKey, @payload::jsonb)
                ON CONFLICT (dedup_key) DO NOTHING RETURNING id`, { dedupKey, payload: json(payload) });
            return r.length > 0;
        },

        async finishNotification(dedupKey: string, ok: boolean, error?: string | null) {
            await q(`UPDATE ai_bot_notifications SET status = @status, attempts = attempts + 1, error = @error,
                sent_at = CASE WHEN @ok THEN now() ELSE sent_at END WHERE dedup_key = @dedupKey`,
            { dedupKey, status: ok ? "sent" : "failed", ok, error: error ? error.slice(0, 500) : null });
        },
    };

    // ─── Hàng đợi ───
    const queue = {
        /** Thêm / dời job chờ của hội thoại (mỗi hội thoại tối đa MỘT job chờ). */
        async enqueue(pageId: string, conversationId: string, source: string, runAfterMs: number): Promise<number | null> {
            // Job đang chờ THỬ LẠI (attempts > 0) giữ giờ giãn cách — tin mới / lượt quét không kéo nó chạy sớm.
            // Hội thoại vừa có job hỏng (10 phút) → không tạo lại ngay (khỏi vòng lặp đọc Pancake hỏng liên tục).
            const [r] = await q(`INSERT INTO ai_bot_jobs (page_id, conversation_id, source, run_after)
                SELECT @pageId, @conversationId, @source, @runAfter
                WHERE NOT EXISTS (SELECT 1 FROM ai_bot_jobs f WHERE f.status = 'failed' AND f.page_id = @pageId
                    AND f.conversation_id = @conversationId AND f.finished_at > now() - interval '10 minutes')
                ON CONFLICT (page_id, conversation_id) WHERE status = 'pending'
                DO UPDATE SET run_after = CASE WHEN ai_bot_jobs.attempts > 0 THEN ai_bot_jobs.run_after
                        ELSE LEAST(ai_bot_jobs.run_after, EXCLUDED.run_after) END,
                    source = EXCLUDED.source, updated_at = now()
                RETURNING id`, { pageId, conversationId, source, runAfter: iso(runAfterMs) });
            return r ? Number(r.id) : null;
        },

        /** Nhận một job tới hạn với mã khoá `token` RIÊNG của lượt nhận. Không nhận job của hội thoại đang có job chạy. */
        async claim(token: string, leaseSeconds: number): Promise<Job | null> {
            const [r] = await q(`UPDATE ai_bot_jobs j SET status = 'running', locked_by = @token,
                    locked_until = now() + make_interval(secs => @lease), attempts = j.attempts + 1, updated_at = now()
                WHERE j.id = (
                    SELECT p.id FROM ai_bot_jobs p
                    WHERE p.status = 'pending' AND p.run_after <= now()
                      AND NOT EXISTS (SELECT 1 FROM ai_bot_jobs r WHERE r.status = 'running' AND r.page_id = p.page_id
                                      AND r.conversation_id = p.conversation_id AND r.locked_until > now())
                    ORDER BY p.run_after, p.id
                    FOR UPDATE SKIP LOCKED LIMIT 1)
                RETURNING j.*`, { token, lease: leaseSeconds });
            return r ? mapJob(r) : null;
        },

        /** Gia hạn thuê job + khoá hội thoại (chỉ khi mình còn giữ). false = đã mất quyền giữ. */
        async renewLease(job: Job, leaseSeconds: number): Promise<boolean> {
            const r = await q(`UPDATE ai_bot_jobs SET locked_until = now() + make_interval(secs => @lease)
                WHERE id = @id AND status = 'running' AND locked_by = @token RETURNING id`, { id: job.id, token: job.lockedBy, lease: leaseSeconds });
            await q(`UPDATE ai_bot_locks SET locked_until = now() + make_interval(secs => @lease)
                WHERE page_id = @pageId AND conversation_id = @conversationId AND locked_by = @token`,
            { pageId: job.pageId, conversationId: job.conversationId, token: job.lockedBy, lease: leaseSeconds });
            return r.length > 0;
        },

        /** Kết thúc job — chỉ khi job còn 'running' và đúng người giữ (job bị thu hồi rồi thì không ghi đè). */
        async finish(job: Job, status: "done" | "failed" | "cancelled", result: string | null, runId: number | null, error: string | null) {
            await q(`UPDATE ai_bot_jobs SET status = @status, result = @result, run_id = @runId, last_error = @error,
                locked_by = NULL, locked_until = NULL, finished_at = now(), updated_at = now()
                WHERE id = @jobId AND status = 'running' AND locked_by = @token`,
            { jobId: job.id, token: job.lockedBy, status, result: result ? result.slice(0, 300) : null, runId, error: error ? error.slice(0, 500) : null });
        },

        /**
         * Đưa job đang chạy về chờ. Đã có job chờ khác của hội thoại (tin mới tới trong lúc chạy) → huỷ job này, dời job kia.
         * `keepAttempt` = false: lượt chờ (debounce / ân hạn) không tính vào số lần thử.
         */
        async requeue(job: Job, runAfterMs: number, reason: string, keepAttempt: boolean, error: string | null = null) {
            const params = { id: job.id, pageId: job.pageId, conversationId: job.conversationId, runAfter: iso(runAfterMs),
                reason: reason.slice(0, 300), error: error ? error.slice(0, 500) : null, dec: keepAttempt ? 0 : 1, token: job.lockedBy };
            const mine = `id = @id AND status = 'running' AND locked_by = @token`;
            const other = await q(`UPDATE ai_bot_jobs SET run_after = LEAST(run_after, @runAfter), updated_at = now()
                WHERE status = 'pending' AND page_id = @pageId AND conversation_id = @conversationId AND id <> @id RETURNING id`, params);
            if (other.length) {
                await q(`UPDATE ai_bot_jobs SET status = 'cancelled', result = @reason, locked_by = NULL, locked_until = NULL,
                    finished_at = now(), updated_at = now() WHERE ${mine}`, params);
                return;
            }
            try {
                await q(`UPDATE ai_bot_jobs SET status = 'pending', run_after = @runAfter, result = @reason, last_error = COALESCE(@error, last_error),
                    attempts = GREATEST(0, attempts - @dec), locked_by = NULL, locked_until = NULL, updated_at = now() WHERE ${mine}`, params);
            } catch (e: any) {
                if (String(e?.code) !== "23505") throw e;          // vừa có job chờ khác chen vào → huỷ job này
                await q(`UPDATE ai_bot_jobs SET status = 'cancelled', result = @reason, locked_by = NULL, locked_until = NULL,
                    finished_at = now(), updated_at = now() WHERE ${mine}`, params);
            }
        },

        /** Job "running" quá hạn thuê (tiến trình chết giữa chừng) → về chờ (hoặc huỷ nếu đã có job chờ). */
        async recoverStuck(): Promise<number> {
            // Chỉ job QUÁ HẠN thuê (người giữ không gia hạn nữa = tiến trình chết). requeue kiểm người giữ = mã trên dòng.
            const rows = await q(`SELECT * FROM ai_bot_jobs WHERE status = 'running' AND locked_until < now() - interval '30 seconds' LIMIT 100`);
            for (const r of rows) await queue.requeue(mapJob(r), now(), "lease_expired", true, "hết hạn thuê (tiến trình dừng giữa chừng?)");
            return rows.length;
        },

        /** Khoá thuê theo hội thoại — mã khoá là mã của JOB (không phải của tiến trình): hai job cùng tiến trình không lọt. */
        async acquireLock(pageId: string, conversationId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
            const r = await q(`INSERT INTO ai_bot_locks (page_id, conversation_id, locked_by, locked_until)
                VALUES (@pageId, @conversationId, @workerId, now() + make_interval(secs => @lease))
                ON CONFLICT (page_id, conversation_id) DO UPDATE SET locked_by = EXCLUDED.locked_by, locked_until = EXCLUDED.locked_until
                WHERE ai_bot_locks.locked_until < now() OR ai_bot_locks.locked_by = EXCLUDED.locked_by
                RETURNING locked_by`, { pageId, conversationId, workerId, lease: leaseSeconds });
            return r.length > 0;
        },

        async releaseLock(pageId: string, conversationId: string, workerId: string) {
            await q(`DELETE FROM ai_bot_locks WHERE page_id = @pageId AND conversation_id = @conversationId AND locked_by = @workerId`,
                { pageId, conversationId, workerId });
        },

        /** Dọn sổ vận hành của module (KHÔNG đụng nhật ký quyết định ai_bot_runs): job xong > 14 ngày, webhook > 7 ngày. */
        async cleanup() {
            await q(`DELETE FROM ai_bot_jobs WHERE status IN ('done', 'failed', 'cancelled') AND finished_at < now() - interval '14 days'`);
            await q(`DELETE FROM ai_bot_webhook_log WHERE received_at < now() - interval '7 days'`);
            await q(`DELETE FROM ai_bot_locks WHERE locked_until < now() - interval '1 day'`);
        },

        async recordProviderCall(c: { purpose: string; provider: string; model: string; inputTokens: number; outputTokens: number;
            costUsd: number; latencyMs: number | null; ok: boolean; error?: string | null; pageId?: string | null }) {
            await q(`INSERT INTO ai_bot_provider_calls (purpose, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, ok, error, page_id)
                VALUES (@purpose, @provider, @model, @inT, @outT, @cost, @lat, @ok, @error, @pageId)`, {
                purpose: c.purpose, provider: c.provider, model: c.model, inT: Math.round(c.inputTokens), outT: Math.round(c.outputTokens),
                cost: c.costUsd, lat: c.latencyMs === null ? null : Math.round(c.latencyMs), ok: c.ok,
                error: c.error ? c.error.slice(0, 500) : null, pageId: c.pageId ?? null,
            });
        },

        /** Mọi page trong hộp thư + trạng thái theo luật page tự động. */
        async allPages(): Promise<PageRow[]> {
            return (await q(`${PAGE_SQL} ORDER BY p.page_id`)).map(toPageRow);
        },

        /** Page được quét (đang chạy theo luật page tự động). */
        async enabledPages(): Promise<PageRow[]> {
            return (await queue.allPages()).filter((p) => p.enabled);
        },

        async savePoll(pageId: string, cursorMs: number | null, error: string | null) {
            await q(`INSERT INTO ai_bot_pages (page_id, last_poll_at, last_error, poll_cursor) VALUES (@pageId, now(), @error, @cursor)
                ON CONFLICT (page_id) DO UPDATE SET last_poll_at = now(), last_error = EXCLUDED.last_error,
                poll_cursor = COALESCE(GREATEST(ai_bot_pages.poll_cursor, EXCLUDED.poll_cursor), ai_bot_pages.poll_cursor)`,
            { pageId, cursor: cursorMs ? iso(cursorMs) : null, error: error ? error.slice(0, 500) : null });
        },

        /**
         * Sức khoẻ page sau lượt quét. Trả true nếu page VỪA chuyển sang lỗi và chưa báo trong 24 giờ (nơi gọi báo Telegram
         * rồi gọi markAlerted).
         */
        async setPageHealth(pageId: string, ok: boolean, code: string | null, detail: string | null): Promise<boolean> {
            const [r] = await q(`INSERT INTO ai_bot_pages (page_id, health, health_code, health_detail, health_at)
                VALUES (@pageId, @health, @code, @detail, now())
                ON CONFLICT (page_id) DO UPDATE SET health = EXCLUDED.health, health_code = EXCLUDED.health_code,
                    health_detail = EXCLUDED.health_detail,
                    health_at = CASE WHEN ai_bot_pages.health IS DISTINCT FROM EXCLUDED.health OR EXCLUDED.health = 'error'
                        THEN now() ELSE ai_bot_pages.health_at END
                RETURNING alerted_at`, { pageId, health: ok ? "ok" : "error", code, detail: detail ? detail.slice(0, 500) : null });
            if (ok) return false;
            const alerted = toMs(r?.alerted_at);
            return alerted === null || now() - alerted > 24 * 3600_000;
        },

        async markAlerted(pageId: string) {
            await q(`UPDATE ai_bot_pages SET alerted_at = now() WHERE page_id = @pageId`, { pageId });
        },
    };

    return {
        store,
        queue,
        /** Ghi KB xong thì gọi — lượt sau đọc lại kho. */
        invalidateKb: () => kbCache.clear(),
    };
}

export type PgStore = ReturnType<typeof createPgStore>;
