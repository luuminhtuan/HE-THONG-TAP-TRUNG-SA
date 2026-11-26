// ═══════════════════════════════════════════════════════════════════
// AI Chatbot (25/11/2026) — kiểu dữ liệu dùng chung. File THUẦN: không import gì ngoài thư mục này
// (test biên dịch bằng tsc trần, không hiểu đường dẫn "@/…"). Xem docs/ai-chatbot/ARCHITECTURE.md.
// ═══════════════════════════════════════════════════════════════════

/** Ý định câu hỏi của khách. `price` mặc định là việc của luật POS (sổ luật `intent:price`). */
export const INTENTS = [
    "product_info", "product_usage", "product_comparison", "service_info", "warranty", "shipping",
    "return_policy", "promotion", "price", "order", "greeting", "general", "human_support", "complaint", "unknown",
] as const;
export type Intent = (typeof INTENTS)[number];

/** Ý định phải chuyển Sale ngay, AI không trả lời (khách muốn chốt đơn, khiếu nại, đòi gặp người). */
export const HANDOFF_INTENTS: ReadonlySet<Intent> = new Set<Intent>(["order", "complaint", "human_support"]);

/** Ai gửi tin: khách · luật trả lời của POS (`is_automated`) · Botcake · tin hệ thống (không admin_name) · chính AI này ·
 *  BOT KHÁC gửi qua Public API (cùng tên gửi "Public API" mà không phải tin của module — vd bot AI Sale cũ) · người thật. */
export type SenderKind = "customer" | "pos_auto" | "botcake" | "system" | "ai_self" | "other_bot" | "human";

export type ChatMessage = {
    id: string;
    kind: SenderKind;
    text: string;
    /** epoch ms */
    at: number;
    senderName?: string | null;
    hasAttachment?: boolean;
};

export type ConversationInfo = {
    id: string;
    pageId: string;
    type?: string | null;
    tags: string[];
    assigneeIds: string[];
    customerName?: string | null;
    insertedAt?: number | null;
};

/** Hội thoại đọc TƯƠI từ Pancake — tin xếp cũ → mới. `complete` = đọc được tới tin đầu tiên của hội thoại. */
export type ConversationSnapshot = {
    conversation: ConversationInfo | null;
    messages: ChatMessage[];
    complete: boolean;
};

export type PageConfig = {
    pageId: string;
    name: string;
    market: string | null;
    enabled: boolean;
    /** Có token page (admin dán) — chỉ khi có mới gửi / gắn tag được. */
    canSend: boolean;
};

export type PosRuleKind = "first_message" | "keyword" | "regex" | "intent";
export type PosRule = {
    id: number;
    pageId: string | null;
    kind: PosRuleKind;
    pattern: string;
    enabled: boolean;
    note?: string | null;
};

export type KbScope = "global" | "market" | "page";
export type KbKind = "product" | "service" | "policy" | "faq" | "page_info" | "pos_rule" | "document";
export type KbSource = "pos_sync" | "admin" | "learning";

export type KbEntry = {
    id: number;
    scope: KbScope;
    market: string | null;
    pageId: string | null;
    kind: KbKind;
    source: KbSource;
    isOfficial: boolean;
    title: string;
    content: string;
    keywords: string[];
    metadata: Record<string, unknown>;
    /** epoch ms lần đồng bộ nguồn gần nhất (giá / tồn kho) — null = nhập tay */
    syncedAt: number | null;
    /** epoch ms hết hiệu lực — null = không hạn */
    validUntil: number | null;
};

/** `queries` = truy vấn tìm kiếm RIÊNG của câu hỏi này (model viết lại — không dấu + ngôn ngữ khách). */
export type Question = { text: string; intent: Intent; queries?: string[] };

export type Classification = {
    language: string;
    primaryIntent: Intent;
    questions: Question[];
    productMentions: string[];
    searchQueries: string[];
    isFollowUp: boolean;
    topicChanged: boolean;
    needsHuman: boolean;
    injectionSuspected: boolean;
    confidence: number;
    source: "model" | "fallback";
};

export type RetrievedItem = {
    entry: KbEntry;
    score: number;
    /** Giá / tồn kho đã cũ hơn `price_max_age_hours` — không đưa giá cho AI. */
    stalePrice: boolean;
    matchedTerms: string[];
};

export type GeneratedAnswer = {
    answer: string;
    language: string;
    usedSourceIds: number[];
    confidence: number;
    unanswered: string[];
};

export type Decision = "answered" | "shadow" | "escalated" | "skipped" | "error";

export type TraceStep = { step: string; ok: boolean; detail?: string };

export type ConversationState = {
    pageId: string;
    conversationId: string;
    pausedUntil: number | null;
    pausedReason: string | null;
    language: string | null;
    lastProducts: number[];
    lastIntent: string | null;
    lastAiReplyAt: number | null;
};

export type RunInput = {
    jobId: number | null;
    pageId: string;
    conversationId: string;
    turnMessageId: string;
    market: string | null;
    customerText: string;
    language: string | null;
    intent: string | null;
    classification: Classification | null;
    retrieved: { id: number; title: string; score: number; stale: boolean }[];
    answer: string | null;
    decision: Decision;
    reason: string;
    provider: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    confidence: number | null;
    durationMs: number;
    sentMessageId: string | null;
    tagStatus: string | null;
    mode: string;
    trace: TraceStep[];
};

// ─── Cổng ra ngoài (router chỉ biết các interface này — Postgres / Pancake / AI thật hay giả đều được) ───

export type AiPurpose = "classify" | "generate" | "test" | "sandbox";
export type AiChatRequest = {
    purpose: AiPurpose;
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    json: boolean;
    temperature: number;
    maxTokens: number;
};
export type AiChatResult = {
    text: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
};
export type AiErrorCode = "config" | "timeout" | "rate_limited" | "http" | "bad_response" | "budget" | "network";

export class AiError extends Error {
    code: AiErrorCode;
    retryable: boolean;
    status?: number;
    /** Token hãng VẪN tính dù lượt lỗi (vd Gemini MAX_TOKENS) — để ghi chi phí đúng. */
    usage?: { inputTokens: number; outputTokens: number };
    constructor(code: AiErrorCode, message: string, retryable: boolean, status?: number) {
        super(message);
        this.name = "AiError";
        this.code = code;
        this.retryable = retryable;
        this.status = status;
    }
}

export interface AiPort {
    chat(req: AiChatRequest): Promise<AiChatResult>;
}

export type SendResult = { ok: boolean; messageId?: string | null; error?: string; ambiguous?: boolean };

export interface ChatPort {
    /**
     * Đọc TƯƠI. `fresh` = bỏ qua bộ đệm danh sách hội thoại (lần soát cuối trước khi gửi); `sinceMs` = hội thoại cập nhật
     * từ mốc này (để tìm đúng hội thoại trong danh sách). Lỗi → ném. `conversation = null` = KHÔNG đọc được tag / người
     * phụ trách → router coi là "không chắc", không gửi.
     */
    fetchConversation(pageId: string, conversationId: string, opts?: { fresh?: boolean; sinceMs?: number }): Promise<ConversationSnapshot>;
    sendText(pageId: string, conversationId: string, text: string): Promise<SendResult>;
    /** Gắn tag theo TÊN (tag phải có sẵn trên Pancake — public API không tạo tag). Không bao giờ tạo tag. Page chưa tạo tag
     *  → `skipped` (tag là TUỲ CHỌN — không phải lỗi, không cần cấu hình từng page). */
    addTag(pageId: string, conversationId: string, tagName: string): Promise<{ ok: boolean; error?: string; skipped?: boolean }>;
}

export type EscalationPayload = {
    pageId: string;
    pageName: string;
    market: string | null;
    conversationId: string;
    customerName: string | null;
    question: string;
    context: string[];
    reason: string;
    reasonLabel: string;
    dashboardUrl: string | null;
    pancakeUrl: string | null;
    mode: string;
};

export interface NotifierPort {
    notify(p: EscalationPayload): Promise<{ ok: boolean; error?: string }>;
}

export type UnansweredInput = {
    pageId: string;
    market: string | null;
    conversationId: string;
    messageId: string;
    text: string;
    intent: string | null;
    language: string | null;
    reason: string;
    runId: number | null;
};

export interface RouterStore {
    getPage(pageId: string): Promise<PageConfig | null>;
    getRunForTurn(pageId: string, conversationId: string, turnMessageId: string): Promise<{ id: number; decision: Decision } | null>;
    /** null = lượt này đã có quyết định (UNIQUE) — không ghi đè. */
    insertRun(run: RunInput): Promise<number | null>;
    getConversationState(pageId: string, conversationId: string): Promise<ConversationState | null>;
    /** Lưu ngôn ngữ / sản phẩm đang bàn / lần AI trả lời — KHÔNG đụng cột tạm dừng (lệnh tạm dừng của Sale không bị đè). */
    saveConversationState(s: ConversationState): Promise<void>;
    /** Tạm dừng AI ở hội thoại tới `untilMs` (chỉ kéo DÀI — không rút ngắn lệnh tạm dừng đang có). */
    pauseConversation(pageId: string, conversationId: string, untilMs: number, reason: string): Promise<void>;
    /** Dòng outbox của lượt (null = chưa giữ chỗ). */
    getOutbox(pageId: string, conversationId: string, turnMessageId: string): Promise<{ status: string; updatedAt: number; text: string } | null>;
    isAssignedOnDashboard(pageId: string, conversationId: string): Promise<boolean>;
    countAiRepliesSince(pageId: string, conversationId: string, sinceMs: number): Promise<number>;
    lastPageSendAt(pageId: string): Promise<number | null>;
    costSince(sinceMs: number): Promise<number>;
    listPosRules(pageId: string): Promise<PosRule[]>;
    knowledgeCandidates(scope: { pageId: string; market: string | null }): Promise<KbEntry[]>;
    ownSentMessageIds(pageId: string, conversationId: string): Promise<Set<string>>;
    /** Chữ các tin module đã gửi ở hội thoại (đã gọn khoảng trắng) — nhận ra tin của mình khi id Pancake khác id lúc gửi. */
    ownSentTexts(pageId: string, conversationId: string): Promise<Set<string>>;
    /** Ghi nhận page đang có bot khác trả lời (page ở chế độ tự động sẽ tự nghỉ). */
    markOtherBot(pageId: string): Promise<void>;
    /** Giữ chỗ gửi (UNIQUE theo lượt) — false = lượt này đã gửi / đang gửi ở nơi khác. */
    reserveOutbox(pageId: string, conversationId: string, turnMessageId: string, text: string): Promise<boolean>;
    finishOutbox(pageId: string, conversationId: string, turnMessageId: string, status: "sent" | "failed" | "unknown",
        pancakeMessageId?: string | null, error?: string | null): Promise<void>;
    recordUnanswered(q: UnansweredInput): Promise<void>;
    reserveNotification(dedupKey: string, payload: unknown): Promise<boolean>;
    finishNotification(dedupKey: string, ok: boolean, error?: string | null): Promise<void>;
}
