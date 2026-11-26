// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — "POS / Sale đã xử lý chưa" (THUẦN, có test). Xem ARCHITECTURE.md §4.
//
// Không có API đọc luật trả lời tự động của Pancake. Nên:
//   • lượt khách = các tin khách LIÊN TIẾP cuối hội thoại; có tin phía page SAU lượt đó = đã có người/máy xử lý
//     (handledBy cho biết ai: luật POS, Botcake, tin hệ thống, sale, chính AI);
//   • sổ luật POS khai trên trang (tin đầu tiên / từ khoá / regex / ý định) khớp TRƯỚC khi gọi AI.
// ═══════════════════════════════════════════════════════════════════
import type { ChatMessage, Intent, PosRule, SenderKind } from "./types";
import { normalizeText } from "./text";

export type TurnAnalysis = {
    /** Có lượt khách nào không (hội thoại toàn tin page → false). */
    hasTurn: boolean;
    turnMessages: ChatMessage[];
    /** Id tin khách CUỐI của lượt — khoá idempotency. */
    turnMessageId: string | null;
    firstCustomerAt: number | null;
    lastCustomerAt: number | null;
    /** Tin phía page ĐẦU TIÊN sau lượt khách (null = chưa ai trả lời). */
    handledBy: SenderKind | null;
    /** Trước lượt này chỉ có tin hệ thống (hoặc không có gì) — lượt đầu tiên của hội thoại. */
    isFirstTurn: boolean;
    priorMessages: ChatMessage[];
    /** Lần gần nhất người thật (sale) nhắn trong hội thoại. */
    lastHumanAt: number | null;
    /** Lần gần nhất tin tự động (POS / Botcake) nhắn. */
    lastAutomationAt: number | null;
    /** Lần gần nhất BOT KHÁC (gửi qua Public API, không phải module này) nhắn. */
    lastOtherBotAt: number | null;
};

const PAGE_SIDE: ReadonlySet<SenderKind> = new Set(["pos_auto", "botcake", "system", "ai_self", "other_bot", "human"]);

export function analyzeTurn(messages: ChatMessage[]): TurnAnalysis {
    const ms = messages || [];
    let lastCustomer = -1;
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].kind === "customer") { lastCustomer = i; break; }
    let lastHumanAt: number | null = null, lastAutomationAt: number | null = null, lastOtherBotAt: number | null = null;
    for (const m of ms) {
        if (m.kind === "human") lastHumanAt = Math.max(lastHumanAt ?? 0, m.at);
        if (m.kind === "pos_auto" || m.kind === "botcake") lastAutomationAt = Math.max(lastAutomationAt ?? 0, m.at);
        if (m.kind === "other_bot") lastOtherBotAt = Math.max(lastOtherBotAt ?? 0, m.at);
    }
    if (lastCustomer < 0) {
        return {
            hasTurn: false, turnMessages: [], turnMessageId: null, firstCustomerAt: null, lastCustomerAt: null,
            handledBy: null, isFirstTurn: false, priorMessages: ms, lastHumanAt, lastAutomationAt, lastOtherBotAt,
        };
    }
    let start = lastCustomer;
    while (start > 0 && ms[start - 1].kind === "customer") start--;
    const turn = ms.slice(start, lastCustomer + 1);
    const after = ms.slice(lastCustomer + 1).find((m) => PAGE_SIDE.has(m.kind)) || null;
    const prior = ms.slice(0, start);
    return {
        hasTurn: true,
        turnMessages: turn,
        turnMessageId: ms[lastCustomer].id,
        firstCustomerAt: turn[0].at,
        lastCustomerAt: ms[lastCustomer].at,
        handledBy: after ? after.kind : null,
        isFirstTurn: prior.every((m) => m.kind === "system"),
        priorMessages: prior,
        lastHumanAt,
        lastAutomationAt,
        lastOtherBotAt,
    };
}

/** Chữ của cả lượt khách (gộp các tin liên tiếp). */
export function turnText(t: TurnAnalysis): string {
    return t.turnMessages.map((m) => m.text).filter(Boolean).join("\n").trim();
}

/**
 * Mẫu regex hợp lệ, không quá dài, và không có lượng từ LỒNG NHAU kiểu (a+)+ / (\w*)* — loại dễ backtracking bùng nổ
 * làm treo cả tiến trình dashboard (regex chạy đồng bộ). Chữ đem so cũng bị cắt ngắn (matchPreRules).
 */
export function validRegex(pattern: string): boolean {
    if (!pattern || pattern.length > 200) return false;
    if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(pattern) || /\.\*.*\.\*.*\.\*/.test(pattern)) return false;
    try { new RegExp(pattern, "iu"); return true; } catch { return false; }
}

/** Từ khoá trong ô luật: phân cách bằng dấu phẩy / xuống dòng; so trên dạng KHÔNG DẤU, khớp nguyên cụm từ. */
export function keywordList(pattern: string): string[] {
    return String(pattern || "").split(/[,\n;]/).map((s) => normalizeText(s)).filter(Boolean);
}

export type PosRuleMatch = { rule: PosRule; label: string } | null;

const REGEX_INPUT_MAX = 1000;

/** Luật POS khớp TRƯỚC khi gọi AI (tin đầu tiên / từ khoá / regex). Luật theo ý định xét sau ở intentCoveredByPos. */
export function matchPreRules(rules: PosRule[], text: string, isFirstTurn: boolean): PosRuleMatch {
    const norm = ` ${normalizeText(text)} `;
    for (const r of rules) {
        if (!r.enabled) continue;
        if (r.kind === "first_message" && isFirstTurn) return { rule: r, label: "tin nhắn đầu tiên" };
        if (r.kind === "keyword") {
            const hit = keywordList(r.pattern).find((k) => norm.includes(` ${k} `));
            if (hit) return { rule: r, label: `từ khoá "${hit}"` };
        }
        if (r.kind === "regex" && validRegex(r.pattern)) {
            const re = new RegExp(r.pattern, "iu");
            if (re.test(text.slice(0, REGEX_INPUT_MAX)) || re.test(norm.trim().slice(0, REGEX_INPUT_MAX))) return { rule: r, label: `mẫu /${r.pattern}/` };
        }
    }
    return null;
}

/** Ý định nào luật POS đã lo (luật kind=intent, pattern = "price" hoặc "price,shipping"). */
export function intentsCoveredByPos(rules: PosRule[]): Set<Intent> {
    const out = new Set<Intent>();
    for (const r of rules) {
        if (!r.enabled || r.kind !== "intent") continue;
        for (const p of String(r.pattern || "").split(/[,\s]+/)) if (p) out.add(p.trim() as Intent);
    }
    return out;
}

/** Tag tắt AI trên hội thoại (so không dấu, không phân biệt hoa thường). Trả tên tag khớp hoặc null. */
export function pauseTagHit(conversationTags: string[], pauseTags: string[]): string | null {
    const wanted = new Set(pauseTags.map((t) => normalizeText(t)).filter(Boolean));
    if (!wanted.size) return null;
    return conversationTags.find((t) => wanted.has(normalizeText(t))) || null;
}

/** Nhãn tiếng Việt của loại người gửi — cho log / Telegram. */
export const SENDER_LABEL: Record<SenderKind, string> = {
    customer: "khách", pos_auto: "luật tự động POS", botcake: "Botcake", system: "tin hệ thống",
    ai_self: "AI (module này)", other_bot: "bot khác (Public API)", human: "sale",
};
