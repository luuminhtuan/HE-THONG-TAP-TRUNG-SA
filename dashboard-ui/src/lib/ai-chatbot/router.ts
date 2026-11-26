// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — MESSAGE ROUTER: mọi quyết định cho MỘT lượt khách (docs/ai-chatbot/ARCHITECTURE.md §2).
//
// File THUẦN về phụ thuộc: chỉ nói chuyện qua các cổng (RouterStore, ChatPort, AiPort, NotifierPort) — Postgres /
// Pancake / AI thật ở worker, bản giả trong bộ nhớ ở test + trang "Chạy thử". Không giữ transaction khi chờ AI: mọi lần
// ghi là câu lệnh ngắn qua store.
//
// Nguyên tắc: không chắc = KHÔNG GỬI. Đọc Pancake lỗi, POS / Sale có dấu hiệu đã xử lý, thiếu kiến thức, câu trả lời
// không có căn cứ, độ tin cậy thấp → không gửi (bỏ qua hoặc chuyển Sale).
// ═══════════════════════════════════════════════════════════════════
import {
    AiError, HANDOFF_INTENTS,
    type AiChatResult, type AiPort, type ChatMessage, type ChatPort, type Classification, type ConversationSnapshot,
    type Decision, type EscalationPayload, type GeneratedAnswer, type KbEntry, type NotifierPort, type PageConfig,
    type Question, type RetrievedItem, type RouterStore, type RunInput, type TraceStep,
} from "./types";
import { canSendLive, type AiSettings } from "./settings";
import { analyzeTurn, intentsCoveredByPos, matchPreRules, pauseTagHit, SENDER_LABEL, turnText, type TurnAnalysis } from "./pos-detect";
import { historyLines, turnLines } from "./context";
import { buildClassifierPrompt, fallbackClassify, parseClassification } from "./classifier";
import { inScope, rankKnowledge, renderKnowledge } from "./retrieval";
import { buildGeneratorPrompt, checkAnswer, parseGenerated } from "./generator";
import { evaluateConfidence } from "./confidence";
import { LEARNABLE_REASONS, reasonLabel } from "./reasons";
import { redactPii, tokenize, truncate } from "./text";
import { compactText } from "./pancake-parse";

export type RouterJob = { jobId: number | null; pageId: string; conversationId: string; attempt: number; source: string };

export type RouterOutcome =
    | { kind: "done"; decision: Decision; reason: string; runId: number | null; answer?: string | null; trace: TraceStep[] }
    | { kind: "requeue"; runAfter: number; reason: string; trace: TraceStep[] }
    | { kind: "retry"; reason: string; error: string; trace: TraceStep[] }
    | { kind: "noop"; reason: string; trace: TraceStep[] };

export type RouterDeps = {
    store: RouterStore;
    chat: ChatPort;
    ai: AiPort;
    notifier: NotifierPort | null;
    now: () => number;
    /** Cài đặt đang dùng (bộ đệm). */
    settings: () => AiSettings;
    /** Đọc LẠI cài đặt từ kho ngay trước khi gửi — tắt AI / chuyển shadow giữa chừng là dừng ngay. Không có → settings(). */
    refreshSettings?: () => Promise<AiSettings>;
    links: (pageId: string, conversationId: string) => { dashboardUrl: string | null; pancakeUrl: string | null };
    log?: (msg: string) => void;
};

const MIN = 60_000;
/** Dòng outbox "đang gửi" cũ hơn mức này = tiến trình chết giữa lúc gửi → không rõ đã gửi chưa. */
const OUTBOX_STUCK_MS = 15 * MIN;
const VN_OFFSET = 7 * 3600_000;
/** 00:00 hôm nay / ngày 1 tháng này theo giờ Việt Nam (trần chi phí tính theo ngày VN). */
export function vnDayStart(now: number): number { return Math.floor((now + VN_OFFSET) / 86_400_000) * 86_400_000 - VN_OFFSET; }
export function vnMonthStart(now: number): number {
    const d = new Date(now + VN_OFFSET);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - VN_OFFSET;
}

type Usage = { provider: string | null; model: string | null; inputTokens: number; outputTokens: number; costUsd: number };

export async function processTurn(job: RouterJob, deps: RouterDeps): Promise<RouterOutcome> {
    const t0 = deps.now();
    const trace: TraceStep[] = [];
    const step = (s: string, ok: boolean, detail?: string) => { trace.push({ step: s, ok, detail }); };
    const S = deps.settings();
    const usage: Usage = { provider: null, model: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const { pageId, conversationId } = job;
    const lastAttempt = job.attempt >= S.max_attempts;

    if (!S.enabled) return { kind: "noop", reason: "ai_disabled", trace };
    const page = await deps.store.getPage(pageId);
    if (!page || !page.enabled) return { kind: "noop", reason: "page_disabled", trace };
    step("page", true, `${page.name || pageId}${page.market ? ` · ${page.market}` : ""}`);

    // ── 1. Đọc hội thoại TƯƠI — nguồn sự thật (payload webhook chỉ là gợi ý) ──
    // Tìm hội thoại trong danh sách cập nhật từ mốc này (tin cũ hơn max_turn_age đằng nào cũng bỏ qua).
    const sinceMs = deps.now() - (S.max_turn_age_minutes + 10) * MIN;
    let snap: ConversationSnapshot;
    try {
        snap = await readSnapshot(deps, pageId, conversationId, false, sinceMs);
    } catch (e) {
        step("read_conversation", false, errText(e));
        return { kind: "retry", reason: "pancake_read_failed", error: errText(e), trace };
    }
    const turn = analyzeTurn(snap.messages);
    if (!turn.hasTurn || !turn.turnMessageId) return { kind: "noop", reason: "no_customer_message", trace };
    const turnId = turn.turnMessageId;
    step("read_conversation", true, `${snap.messages.length} tin · lượt khách ${turn.turnMessages.length} tin`);

    // ── 2. Idempotency theo message id: lượt này đã có quyết định cuối → thôi ──
    const existing = await deps.store.getRunForTurn(pageId, conversationId, turnId);
    if (existing) return { kind: "noop", reason: `already_decided:${existing.decision}`, trace };

    const text = turnText(turn);
    // Mọi chữ khách đi ra NGOÀI (AI, Telegram, nhật ký) là bản đã che SĐT / email.
    const safeText = redactPii(text);
    const now = deps.now();
    const base = {
        jobId: job.jobId, pageId, conversationId, turnMessageId: turnId, market: page.market,
        customerText: truncate(safeText, 2000),
    };
    let classification: Classification | null = null;
    let retrievedLog: RunInput["retrieved"] = [];

    const finish = async (decision: Decision, reason: string, extra: Partial<RunInput> = {}): Promise<RouterOutcome> => {
        const run: RunInput = {
            ...base,
            language: classification?.language ?? null,
            intent: classification?.primaryIntent ?? null,
            classification,
            retrieved: retrievedLog,
            answer: null,
            decision,
            reason,
            provider: usage.provider,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
            confidence: null,
            durationMs: Math.max(0, deps.now() - t0),
            sentMessageId: null,
            tagStatus: null,
            mode: S.mode,
            trace,
            ...extra,
        };
        const runId = await deps.store.insertRun(run);
        deps.log?.(`[ai-chatbot] ${pageId}/${conversationId} → ${decision} (${reason})`);
        return { kind: "done", decision, reason, runId, answer: run.answer, trace };
    };

    // ── 3. Đã có người / luật tự động trả lời sau lượt khách → không chen ──
    if (turn.handledBy) {
        step("already_handled", true, SENDER_LABEL[turn.handledBy]);
        if (turn.handledBy === "other_bot") await deps.store.markOtherBot(pageId);
        return finish("skipped", `already_handled:${turn.handledBy}`);
    }
    if (now - (turn.lastCustomerAt || 0) > S.max_turn_age_minutes * MIN) return finish("skipped", "too_old");

    // ── 4. Chờ khách gõ xong (debounce) + chờ luật tự động của POS chạy (ân hạn) ──
    const waitMs = Math.max(S.debounce_seconds, S.pos_grace_seconds) * 1000;
    if (now - (turn.lastCustomerAt || 0) < waitMs) {
        return { kind: "requeue", runAfter: (turn.lastCustomerAt || now) + waitMs, reason: "waiting_pos_grace", trace };
    }

    // Ngữ cảnh dùng chung cho chuyển Sale
    const escalate = (reason: string, opts: { questions?: Question[]; draft?: string | null; confidence?: number | null } = {}) =>
        doEscalate(deps, S, page, snap, turn, base, reason, opts, trace, finish);

    // Không đọc được tag / người phụ trách = không biết Sale đã nhận chưa → không gửi: thử lại, hết lượt thì chuyển Sale.
    if (!snap.conversation) {
        step("read_conversation", false, "không đọc được tag / người phụ trách của hội thoại");
        if (!lastAttempt) return { kind: "retry", reason: "conversation_info_unavailable", error: "không thấy hội thoại trong danh sách Pancake", trace };
        return escalate("conversation_info_unavailable");
    }

    // Lượt này đã giữ chỗ gửi (tiến trình dừng giữa chừng lần trước): đang gửi ở nơi khác → thôi; kẹt / không rõ → chuyển
    // Sale (không gửi lại, không tốn AI); đã gửi mà chưa kịp ghi nhật ký → ghi bù.
    const ob = await deps.store.getOutbox(pageId, conversationId, turnId);
    if (ob) {
        if (ob.status === "sent") return finish("answered", "answered_recovered", { answer: ob.text });
        if (ob.status === "sending" && now - ob.updatedAt < OUTBOX_STUCK_MS) return { kind: "noop", reason: "send_in_progress", trace };
        return escalate("send_unknown");
    }

    // ── 5. Sale / tạm dừng ──
    const guard = await saleGuards(deps, S, pageId, conversationId, snap, turn, now);
    if (guard) { step("sale_guard", true, guard); return finish("skipped", guard); }

    // ── 6. Sổ luật POS (tin đầu tiên / từ khoá / regex) — xét TRƯỚC tin không chữ: ảnh ở tin đầu vẫn là việc của POS ──
    const rules = await deps.store.listPosRules(pageId);
    const pre = matchPreRules(rules, text, turn.isFirstTurn);
    if (pre) { step("pos_rule", true, pre.label); return finish("skipped", `pos_rule:${pre.rule.id}`); }
    step("pos_rule", true, "không luật nào khớp");
    if (!text) return escalate("non_text");

    // ── 7. Trần chi phí + số lượt trả lời ──
    const [costDay, costMonth] = await Promise.all([deps.store.costSince(vnDayStart(now)), deps.store.costSince(vnMonthStart(now))]);
    if (costDay >= S.daily_cost_limit_usd || costMonth >= S.monthly_cost_limit_usd) {
        step("budget", false, `ngày $${costDay.toFixed(4)} / tháng $${costMonth.toFixed(4)}`);
        return escalate("budget_exceeded");
    }
    const recentReplies = await deps.store.countAiRepliesSince(pageId, conversationId, now - 60 * MIN);
    if (recentReplies >= S.max_replies_per_conversation_hour) return escalate("reply_limit");

    // ── 8. Phân loại (model nhẹ; lỗi → bộ dự phòng không cần AI) ──
    const state = await deps.store.getConversationState(pageId, conversationId);
    const candidatesAll = await deps.store.knowledgeCandidates({ pageId, market: page.market });
    const candidates = candidatesAll.filter((e) => inScope(e, pageId, page.market, now));
    const recentProductTitles = (state?.lastProducts || [])
        .map((id) => candidates.find((e) => e.id === id)?.title).filter((x): x is string => !!x);
    const history = historyLines(turn.priorMessages, S.context_messages, S.context_chars);
    const turnTextLines = turnLines(turn.turnMessages);
    try {
        const p = buildClassifierPrompt({ pageName: page.name, history, turn: turnTextLines, recentProducts: recentProductTitles });
        const r = await callJson(deps, usage, "classify", p.system, p.user, S.classifier_max_tokens, 0, (t) => parseClassification(t, safeText));
        classification = r;
        step("classify", !!r, r ? `${r.primaryIntent} · ${r.language} · ${r.confidence}` : "JSON không hợp lệ → dự phòng");
    } catch (e) {
        if (e instanceof AiError && e.code === "budget") return escalate("budget_exceeded");
        step("classify", false, errText(e));
    }
    if (!classification) classification = fallbackClassify(safeText);

    // ── 9. Luật POS theo ý định (vd hỏi giá) + ý định phải chuyển Sale ──
    const covered = intentsCoveredByPos(rules);
    const allQuestions = classification.questions.length ? classification.questions : [{ text: safeText, intent: classification.primaryIntent }];
    const posQs = allQuestions.filter((q) => covered.has(q.intent));
    const questions = allQuestions.filter((q) => !covered.has(q.intent));
    if (!questions.length) {
        step("pos_rule_intent", true, posQs.map((q) => q.intent).join(", "));
        return finish("skipped", `pos_rule:intent:${[...new Set(posQs.map((q) => q.intent))].join(",")}`);
    }
    const handoff = questions.find((q) => HANDOFF_INTENTS.has(q.intent));
    if (classification.needsHuman || handoff) return escalate(`intent:${handoff?.intent || "needs_human"}`, { questions });
    const real = questions.filter((q) => q.intent !== "greeting");
    if (!real.length) return finish("skipped", "greeting_only");
    if (classification.injectionSuspected && real.every((q) => q.intent === "unknown" || q.intent === "general")) {
        return escalate("suspicious_input", { questions: real });
    }

    // ── 10. Truy xuất kiến thức cho từng câu hỏi ──
    const opts = {
        topK: S.top_k, minScore: S.min_retrieval_score, now, priceMaxAgeMs: S.price_max_age_hours * 3600_000,
        boostIds: classification.isFollowUp && !classification.topicChanged ? state?.lastProducts || [] : [],
        synonyms: S.synonyms,
    };
    const perQuestion = real.map((q) => {
        const items = q.intent === "unknown" ? [] : rankKnowledge(candidates, questionQueries(q, classification!, real.length), opts);
        return { q, items, best: items[0]?.score ?? 0 };
    });
    const answerable = perQuestion.filter((x) => x.best >= S.min_retrieval_score);
    const unanswerable = perQuestion.filter((x) => x.best < S.min_retrieval_score).map((x) => x.q);
    const merged = mergeRetrieved(answerable.flatMap((x) => x.items), S.top_k);
    retrievedLog = merged.map((it) => ({ id: it.entry.id, title: it.entry.title, score: round3(it.score), stale: it.stalePrice }));
    step("retrieve", answerable.length > 0, `${candidates.length} mục trong phạm vi · ${answerable.length}/${real.length} câu có dữ liệu`);
    if (!answerable.length) return escalate("no_knowledge", { questions: real });
    if (unanswerable.length && !S.allow_partial_answers) return escalate("no_knowledge_partial", { questions: unanswerable });

    // ── 11. Sinh câu trả lời + soát căn cứ ──
    const knowledge = renderKnowledge(merged, Math.max(1500, S.context_chars), now);
    let gen: GeneratedAnswer | null = null;
    try {
        const p = buildGeneratorPrompt({
            pageName: page.name, persona: S.persona, language: classification.language, maxChars: S.max_answer_chars,
            knowledge, history, turn: turnTextLines, questions: answerable.map((x) => x.q),
        });
        gen = await callJson(deps, usage, "generate", p.system, p.user, S.max_tokens, S.temperature, parseGenerated);
    } catch (e) {
        if (e instanceof AiError && e.code === "budget") return escalate("budget_exceeded", { questions: real });
        step("generate", false, errText(e));
        if (!lastAttempt && (!(e instanceof AiError) || e.retryable)) return { kind: "retry", reason: "ai_error", error: errText(e), trace };
        return escalate("ai_error", { questions: real });
    }
    if (!gen) { step("generate", false, "JSON không hợp lệ (2 lần)"); return escalate("generation_invalid", { questions: real }); }
    step("generate", true, `${gen.answer.length} ký tự · tự chấm ${gen.confidence}`);

    const unansweredAll = [...unanswerable.map((q) => q.text), ...gen.unanswered];
    if (!gen.answer) return escalate("no_knowledge", { questions: real });
    const check = checkAnswer(gen, {
        retrievedIds: merged.map((it) => it.entry.id), sourceText: knowledge, customerText: text,
        expectedLanguage: classification.language, maxChars: S.max_answer_chars,
    });
    step("check_answer", check.ok, check.problems.join(", ") || "đạt");
    if (!check.ok) return escalate(`answer_rejected:${check.problems[0]}`, { questions: real, draft: gen.answer });

    const conf = evaluateConfidence({
        classification, generated: gen, retrievalScores: answerable.map((x) => x.best), checkProblems: check.problems,
        answeredQuestions: Math.max(0, answerable.length - gen.unanswered.length), totalQuestions: real.length,
    });
    step("confidence", conf.score >= S.confidence_threshold, `${conf.score} (ngưỡng ${S.confidence_threshold})`);
    if (conf.score < S.confidence_threshold) {
        return escalate("low_confidence", { questions: real, draft: gen.answer, confidence: conf.score });
    }
    if (unansweredAll.length && !S.allow_partial_answers) {
        return escalate("no_knowledge_partial", { questions: unansweredAll.map((t) => ({ text: t, intent: "unknown" })), draft: gen.answer });
    }

    // ── 12. Đọc lại NGAY TRƯỚC KHI GỬI: khách nhắn thêm / page vừa trả lời / sale vừa nhận / AI bị tắt ──
    const S2 = deps.refreshSettings ? await deps.refreshSettings() : deps.settings();
    const page2 = await deps.store.getPage(pageId);
    if (!S2.enabled || !page2?.enabled) return finish("skipped", "ai_disabled_during_processing", { answer: gen.answer, confidence: conf.score });
    let snap2: ConversationSnapshot;
    try {
        snap2 = await readSnapshot(deps, pageId, conversationId, true, sinceMs);
    } catch (e) {
        step("recheck", false, errText(e));
        if (!lastAttempt) return { kind: "retry", reason: "recheck_failed", error: errText(e), trace };
        return escalate("recheck_failed", { questions: real, draft: gen.answer });
    }
    if (!snap2.conversation) {
        step("recheck", false, "không đọc được tag / người phụ trách");
        if (!lastAttempt) return { kind: "retry", reason: "conversation_info_unavailable", error: "không thấy hội thoại khi đọc lại", trace };
        return escalate("conversation_info_unavailable", { questions: real, draft: gen.answer });
    }
    const turn2 = analyzeTurn(snap2.messages);
    if (turn2.turnMessageId !== turnId) {
        step("recheck", true, "khách nhắn thêm — soạn lại cả lượt");
        return { kind: "requeue", runAfter: deps.now() + S2.debounce_seconds * 1000, reason: "customer_sent_more", trace };
    }
    if (turn2.handledBy) {
        step("recheck", true, `${SENDER_LABEL[turn2.handledBy]} vừa trả lời`);
        return finish("skipped", `handled_during_processing:${turn2.handledBy}`, { answer: gen.answer, confidence: conf.score });
    }
    const guard2 = await saleGuards(deps, S2, pageId, conversationId, snap2, turn2, deps.now());
    if (guard2) { step("recheck", true, guard2); return finish("skipped", guard2, { answer: gen.answer, confidence: conf.score }); }
    step("recheck", true, "không có gì mới");

    const partial = unansweredAll.length > 0;
    const usedProducts = gen.usedSourceIds.filter((id) => merged.find((it) => it.entry.id === id)?.entry.kind === "product");

    // ── 13. Gửi (chỉ live + hội thoại được phép) ──
    if (!canSendLive(S2, conversationId)) {
        if (partial) await recordLearning(deps, base, page, unansweredAll.map((t) => ({ text: t, intent: "unknown" })), classification, "answered_partial");
        await saveState(deps, pageId, conversationId, state, { language: classification.language, products: usedProducts, intent: classification.primaryIntent, replied: false });
        return finish("shadow", S2.mode === "live" ? "not_in_live_test_list" : "shadow_mode", { answer: gen.answer, confidence: conf.score });
    }
    if (!page2.canSend) return escalate("no_page_token", { questions: real, draft: gen.answer });

    const lastSend = await deps.store.lastPageSendAt(pageId);
    const gap = S2.min_seconds_between_sends_page * 1000;
    if (lastSend && deps.now() - lastSend < gap) {
        return { kind: "requeue", runAfter: lastSend + gap, reason: "page_pacing", trace };
    }
    const reserved = await deps.store.reserveOutbox(pageId, conversationId, turnId, gen.answer);
    if (!reserved) return { kind: "noop", reason: "duplicate_send_prevented", trace };
    const sent = await deps.chat.sendText(pageId, conversationId, gen.answer);
    if (!sent.ok) {
        await deps.store.finishOutbox(pageId, conversationId, turnId, sent.ambiguous ? "unknown" : "failed", null, sent.error || null);
        step("send", false, sent.error || "lỗi");
        return escalate(sent.ambiguous ? "send_unknown" : `send_failed:${truncate(sent.error || "", 80)}`, { questions: real, draft: gen.answer });
    }
    await deps.store.finishOutbox(pageId, conversationId, turnId, "sent", sent.messageId || null, null);
    step("send", true, sent.messageId || "đã gửi");

    const tag: { ok: boolean; error?: string; skipped?: boolean } = await deps.chat.addTag(pageId, conversationId, S2.tag_answered)
        .catch((e) => ({ ok: false, error: errText(e) }));
    step("tag", tag.ok, tag.skipped ? tag.error : tag.ok ? S2.tag_answered : tag.error);
    await saveState(deps, pageId, conversationId, state, { language: classification.language, products: usedProducts, intent: classification.primaryIntent, replied: true });

    if (partial) {
        // Phần chưa trả lời: học + báo Sale (không tạm dừng AI vì khách đã được trả lời một phần).
        await recordLearning(deps, base, page, unansweredAll.map((t) => ({ text: t, intent: "unknown" })), classification, "answered_partial");
        const helpTag = await deps.chat.addTag(pageId, conversationId, S2.tag_needs_help).catch((e) => ({ ok: false, error: errText(e) }));
        step("tag_needs_help", helpTag.ok, helpTag.ok ? S2.tag_needs_help : helpTag.error);
        await notifySale(deps, S2, page, snap2, turn2, base, "answered_partial", unansweredAll.join(" · "), trace);
    }
    return finish("answered", partial ? "answered_partial" : "answered", {
        answer: gen.answer, confidence: conf.score, sentMessageId: sent.messageId || null,
        tagStatus: tag.skipped ? "skipped: page chưa tạo tag" : tag.ok ? "ok" : `failed: ${truncate(tag.error || "", 120)}`,
    });
}

// ─── Phụ trợ ───────────────────────────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** Đọc hội thoại + đánh dấu tin của chính module (id trong outbox) là ai_self. */
async function readSnapshot(deps: RouterDeps, pageId: string, conversationId: string, fresh: boolean, sinceMs: number): Promise<ConversationSnapshot> {
    const [snap, own, ownTexts] = await Promise.all([
        deps.chat.fetchConversation(pageId, conversationId, { fresh, sinceMs }),
        deps.store.ownSentMessageIds(pageId, conversationId),
        deps.store.ownSentTexts(pageId, conversationId),
    ]);
    if (!own.size && !ownTexts.size) return snap;
    const mine = (m: ChatMessage) => m.kind !== "customer" && (own.has(m.id) || (m.kind === "other_bot" && ownTexts.has(compactText(m.text))));
    return { ...snap, messages: snap.messages.map((m): ChatMessage => (mine(m) ? { ...m, kind: "ai_self" } : m)) };
}

/** Sale đang xử lý / AI tạm dừng → mã lý do; không gì → null. */
async function saleGuards(deps: RouterDeps, S: AiSettings, pageId: string, conversationId: string,
    snap: ConversationSnapshot, turn: TurnAnalysis, now: number): Promise<string | null> {
    const state = await deps.store.getConversationState(pageId, conversationId);
    if (state?.pausedUntil && state.pausedUntil > now) return `paused:${state.pausedReason || "manual"}`;
    if (S.respect_dashboard_assignment && await deps.store.isAssignedOnDashboard(pageId, conversationId)) return "sale_assigned_dashboard";
    const tag = pauseTagHit(snap.conversation?.tags || [], S.pause_tags);
    if (tag) return `pause_tag:${tag}`;
    if (S.respect_pancake_assignee && (snap.conversation?.assigneeIds.length || 0) > 0) return "sale_assigned_pancake";
    if (turn.lastHumanAt && now - turn.lastHumanAt < S.sale_quiet_minutes * MIN) return "sale_active";
    // Bot KHÁC (gửi qua Public API — vd bot AI Sale cũ) đang trả lời hội thoại này → né, và đánh dấu page.
    if (turn.lastOtherBotAt && now - turn.lastOtherBotAt < S.other_bot_quiet_hours * 3600_000) {
        await deps.store.markOtherBot(pageId);
        return "other_bot_active";
    }
    return null;
}

/** Gọi model, đọc JSON; JSON hỏng → gọi lại MỘT lần nhắc trả JSON đúng. Cộng token / tiền vào `usage`. */
async function callJson<T>(deps: RouterDeps, usage: Usage, purpose: "classify" | "generate", system: string, user: string,
    maxTokens: number, temperature: number, parse: (t: string) => T | null): Promise<T | null> {
    const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: user }];
    for (let i = 0; i < 2; i++) {
        const r: AiChatResult = await deps.ai.chat({ purpose, system, messages, json: true, temperature, maxTokens });
        usage.provider = r.provider;
        usage.model = r.model;
        usage.inputTokens += r.inputTokens;
        usage.outputTokens += r.outputTokens;
        usage.costUsd += r.costUsd;
        const parsed = parse(r.text);
        if (parsed) return parsed;
        messages.push({ role: "assistant", content: truncate(r.text, 2000) });
        messages.push({ role: "user", content: "That was not valid JSON for the required schema. Reply again with ONLY the JSON object." });
    }
    return null;
}

const PRODUCT_INTENTS = new Set(["product_info", "product_usage", "product_comparison", "warranty", "promotion"]);

/**
 * Truy vấn tìm kiếm của MỘT câu hỏi: câu hỏi + truy vấn riêng model viết cho nó. Truy vấn / tên SP cấp lượt chỉ dùng khi
 * lượt có một câu hỏi, hoặc khi liên quan tới câu này — kẻo câu "có ship không?" mượn truy vấn về sản phẩm của câu bên
 * cạnh mà "khớp" kiến thức không trả lời nó.
 */
export function questionQueries(q: Question, cls: Classification, questionCount: number): string[] {
    const own = q.queries || [];
    if (questionCount <= 1) return [q.text, ...own, ...cls.searchQueries, ...cls.productMentions];
    const qTokens = new Set(tokenize(`${q.text} ${own.join(" ")}`));
    const related = (s: string) => tokenize(s).some((t) => qTokens.has(t));
    return [
        q.text, ...own,
        ...cls.searchQueries.filter(related),
        ...(PRODUCT_INTENTS.has(q.intent) ? cls.productMentions : cls.productMentions.filter(related)),
    ];
}

/** Gộp mục truy xuất của nhiều câu hỏi: giữ điểm cao nhất mỗi mục, top-k. */
function mergeRetrieved(items: RetrievedItem[], topK: number): RetrievedItem[] {
    const best = new Map<number, RetrievedItem>();
    for (const it of items) {
        const cur = best.get(it.entry.id);
        if (!cur || it.score > cur.score) best.set(it.entry.id, it);
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
}

async function saveState(deps: RouterDeps, pageId: string, conversationId: string,
    prev: Awaited<ReturnType<RouterStore["getConversationState"]>>,
    u: { language: string; products: number[]; intent: string; replied: boolean }) {
    // Cột tạm dừng KHÔNG ghi ở đây (store bỏ qua) — tạm dừng đi qua store.pauseConversation.
    await deps.store.saveConversationState({
        pageId, conversationId,
        pausedUntil: prev?.pausedUntil ?? null,
        pausedReason: prev?.pausedReason ?? null,
        language: u.language || prev?.language || null,
        lastProducts: u.products.length ? u.products : prev?.lastProducts || [],
        lastIntent: u.intent || prev?.lastIntent || null,
        lastAiReplyAt: u.replied ? deps.now() : prev?.lastAiReplyAt ?? null,
    });
}

async function recordLearning(deps: RouterDeps, base: { pageId: string; conversationId: string; turnMessageId: string; market: string | null; customerText: string },
    page: PageConfig, questions: Question[], cls: Classification | null, reason: string): Promise<void> {
    const qs = questions.length ? questions : [{ text: base.customerText, intent: cls?.primaryIntent || "unknown" } as Question];
    for (const q of qs.slice(0, 5)) {
        try {
            await deps.store.recordUnanswered({
                pageId: page.pageId, market: page.market, conversationId: base.conversationId, messageId: base.turnMessageId,
                text: truncate(redactPii(q.text), 500), intent: q.intent, language: cls?.language || null, reason, runId: null,
            });
        } catch (e) { deps.log?.(`[ai-chatbot] ghi AI Learning lỗi: ${errText(e)}`); }
    }
}

/** Telegram cho Sale — chống trùng theo lượt khách (bảng ai_bot_notifications). Lỗi Telegram không làm hỏng lượt. */
async function notifySale(deps: RouterDeps, S: AiSettings, page: PageConfig, snap: ConversationSnapshot, turn: TurnAnalysis,
    base: { pageId: string; conversationId: string; turnMessageId: string; customerText: string }, reason: string,
    extra: string, trace: TraceStep[]): Promise<void> {
    const live = canSendLive(S, base.conversationId);
    if (!deps.notifier || !S.telegram.enabled || !S.telegram.chat_id || (!live && !S.telegram.notify_in_shadow)) return;
    const key = `esc:${base.pageId}:${base.conversationId}:${base.turnMessageId}`;
    try {
        if (!(await deps.store.reserveNotification(key, { reason }))) { trace.push({ step: "telegram", ok: true, detail: "đã báo lượt này" }); return; }
        const links = deps.links(base.pageId, base.conversationId);
        const payload: EscalationPayload = {
            pageId: base.pageId, pageName: page.name, market: page.market, conversationId: base.conversationId,
            customerName: snap.conversation?.customerName || null,
            question: truncate(base.customerText, 800),
            context: historyLines(turn.priorMessages, 4, 900),
            reason, reasonLabel: `${reasonLabel(reason)}${extra ? ` — ${truncate(extra, 300)}` : ""}`,
            dashboardUrl: links.dashboardUrl, pancakeUrl: links.pancakeUrl, mode: S.mode,
        };
        const r = await deps.notifier.notify(payload);
        await deps.store.finishNotification(key, r.ok, r.error || null);
        trace.push({ step: "telegram", ok: r.ok, detail: r.error });
    } catch (e) {
        trace.push({ step: "telegram", ok: false, detail: errText(e) });
    }
}

/** Chuyển Sale: (live) tag "Cần hỗ trợ" + AI Learning + Telegram + tạm dừng AI ở hội thoại một lúc. */
async function doEscalate(
    deps: RouterDeps, S: AiSettings, page: PageConfig, snap: ConversationSnapshot, turn: TurnAnalysis,
    base: { jobId: number | null; pageId: string; conversationId: string; turnMessageId: string; market: string | null; customerText: string },
    reason: string, opts: { questions?: Question[]; draft?: string | null; confidence?: number | null }, trace: TraceStep[],
    finish: (d: Decision, r: string, extra?: Partial<RunInput>) => Promise<RouterOutcome>,
): Promise<RouterOutcome> {
    const key = reason.split(":")[0];
    if (LEARNABLE_REASONS.has(key)) await recordLearning(deps, base, page, opts.questions || [], null, reason);
    let tagStatus: string | null = null;
    if (canSendLive(S, base.conversationId) && page.canSend) {
        const t: { ok: boolean; error?: string; skipped?: boolean } = await deps.chat.addTag(base.pageId, base.conversationId, S.tag_needs_help)
            .catch((e) => ({ ok: false, error: errText(e) }));
        tagStatus = t.skipped ? "skipped: page chưa tạo tag" : t.ok ? "ok" : `failed: ${truncate(t.error || "", 120)}`;
        trace.push({ step: "tag_needs_help", ok: t.ok, detail: t.ok ? S.tag_needs_help : t.error });
    }
    await notifySale(deps, S, page, snap, turn, base, reason, "", trace);
    if (S.escalation_pause_minutes > 0 && key !== "budget_exceeded") {
        await deps.store.pauseConversation(base.pageId, base.conversationId, deps.now() + S.escalation_pause_minutes * MIN, "escalated");
    }
    return finish("escalated", reason, { answer: opts.draft ?? null, confidence: opts.confidence ?? null, tagStatus });
}

/** Dùng ở trang "Chạy thử" và log: mục KB → dòng ngắn. */
export function describeEntry(e: KbEntry): string {
    return `#${e.id} ${e.title} (${e.kind}${e.market ? ` · ${e.market}` : ""})`;
}
