// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — RouterStore trong bộ nhớ (THUẦN). Dùng cho test tự động và trang "Chạy thử" (sandbox): chạy đủ quy trình
// router mà không ghi database, không gọi Pancake. Hành vi UNIQUE (lượt, outbox, thông báo) giống bản Postgres.
// ═══════════════════════════════════════════════════════════════════
import type {
    ConversationState, Decision, KbEntry, PageConfig, PosRule, RouterStore, RunInput, UnansweredInput,
} from "./types";

export class MemoryStore implements RouterStore {
    pages = new Map<string, PageConfig>();
    runs: (RunInput & { id: number; createdAt: number })[] = [];
    states = new Map<string, ConversationState>();
    assigned = new Set<string>();
    rules: PosRule[] = [];
    kb: KbEntry[] = [];
    outbox = new Map<string, { status: string; text: string; messageId?: string | null; at: number }>();
    unanswered: UnansweredInput[] = [];
    notifications = new Map<string, { ok: boolean | null; error?: string | null }>();
    cost: { at: number; usd: number }[] = [];
    constructor(private now: () => number = Date.now) {}

    private k(pageId: string, conversationId: string) { return `${pageId}|${conversationId}`; }

    async getPage(pageId: string) { return this.pages.get(pageId) || null; }
    async getRunForTurn(pageId: string, conversationId: string, turnMessageId: string) {
        const r = this.runs.find((x) => x.pageId === pageId && x.conversationId === conversationId && x.turnMessageId === turnMessageId);
        return r ? { id: r.id, decision: r.decision as Decision } : null;
    }
    async insertRun(run: RunInput) {
        if (this.runs.some((x) => x.pageId === run.pageId && x.conversationId === run.conversationId && x.turnMessageId === run.turnMessageId)) return null;
        const id = this.runs.length + 1;
        this.runs.push({ ...run, id, createdAt: this.now() });
        if (run.costUsd) this.cost.push({ at: this.now(), usd: run.costUsd });
        return id;
    }
    async getConversationState(pageId: string, conversationId: string) { return this.states.get(this.k(pageId, conversationId)) || null; }
    async saveConversationState(s: ConversationState) {
        const cur = this.states.get(this.k(s.pageId, s.conversationId));
        this.states.set(this.k(s.pageId, s.conversationId), { ...s, pausedUntil: cur?.pausedUntil ?? null, pausedReason: cur?.pausedReason ?? null });
    }
    async pauseConversation(pageId: string, conversationId: string, untilMs: number, reason: string) {
        const k = this.k(pageId, conversationId);
        const cur = this.states.get(k) || { pageId, conversationId, pausedUntil: null, pausedReason: null, language: null, lastProducts: [], lastIntent: null, lastAiReplyAt: null };
        if (cur.pausedUntil && cur.pausedUntil >= untilMs) return;
        this.states.set(k, { ...cur, pausedUntil: untilMs, pausedReason: reason });
    }
    async getOutbox(pageId: string, conversationId: string, turnMessageId: string) {
        const r = this.outbox.get(`${pageId}|${conversationId}|${turnMessageId}`);
        return r ? { status: r.status, updatedAt: r.at, text: r.text } : null;
    }
    async isAssignedOnDashboard(pageId: string, conversationId: string) { return this.assigned.has(this.k(pageId, conversationId)); }
    async countAiRepliesSince(pageId: string, conversationId: string, sinceMs: number) {
        return this.runs.filter((r) => r.pageId === pageId && r.conversationId === conversationId && r.decision === "answered" && r.createdAt >= sinceMs).length;
    }
    async lastPageSendAt(pageId: string) {
        const ts = [...this.outbox.entries()].filter(([k, v]) => k.startsWith(`${pageId}|`) && v.status === "sent").map(([, v]) => v.at);
        return ts.length ? Math.max(...ts) : null;
    }
    async costSince(sinceMs: number) { return this.cost.filter((c) => c.at >= sinceMs).reduce((a, c) => a + c.usd, 0); }
    async listPosRules(pageId: string) { return this.rules.filter((r) => r.pageId === null || r.pageId === pageId); }
    async knowledgeCandidates() { return this.kb; }
    async ownSentMessageIds(pageId: string, conversationId: string) {
        const prefix = `${pageId}|${conversationId}|`;
        return new Set([...this.outbox.entries()].filter(([k, v]) => k.startsWith(prefix) && v.messageId).map(([, v]) => String(v.messageId)));
    }
    otherBotPages = new Map<string, number>();
    async ownSentTexts(pageId: string, conversationId: string) {
        const prefix = `${pageId}|${conversationId}|`;
        return new Set([...this.outbox.entries()].filter(([k, v]) => k.startsWith(prefix) && v.status === "sent").map(([, v]) => v.text.replace(/\s+/g, " ").trim()));
    }
    async markOtherBot(pageId: string) { this.otherBotPages.set(pageId, this.now()); }
    async reserveOutbox(pageId: string, conversationId: string, turnMessageId: string, text: string) {
        const key = `${pageId}|${conversationId}|${turnMessageId}`;
        if (this.outbox.has(key)) return false;
        this.outbox.set(key, { status: "sending", text, at: this.now() });
        return true;
    }
    async finishOutbox(pageId: string, conversationId: string, turnMessageId: string, status: "sent" | "failed" | "unknown", messageId?: string | null) {
        const key = `${pageId}|${conversationId}|${turnMessageId}`;
        const cur = this.outbox.get(key);
        if (cur) this.outbox.set(key, { ...cur, status, messageId: messageId ?? null, at: this.now() });
    }
    async recordUnanswered(q: UnansweredInput) { this.unanswered.push(q); }
    async reserveNotification(key: string) {
        if (this.notifications.has(key)) return false;
        this.notifications.set(key, { ok: null });
        return true;
    }
    async finishNotification(key: string, ok: boolean, error?: string | null) { this.notifications.set(key, { ok, error }); }
}
