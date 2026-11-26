// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — AI Learning (THUẦN, có test): gom câu hỏi AI chưa trả lời được thành nhóm câu tương tự để admin / sale
// trả lời một lần → duyệt thành FAQ → câu tương tự về sau AI tự trả lời. AI KHÔNG tự sửa kiến thức chính thức.
// ═══════════════════════════════════════════════════════════════════
import { jaccard, normalizeText, tokenize } from "./text";

export const LEARNING_STATUSES = ["pending", "processing", "approved", "ignored"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

/** Chữ ký câu hỏi: dạng chuẩn hoá + tập từ có nghĩa (đã bỏ từ dừng, sắp xếp). */
export function questionSignature(text: string): { normalized: string; tokens: string[] } {
    return { normalized: normalizeText(text).slice(0, 500), tokens: [...new Set(tokenize(text))].sort().slice(0, 40) };
}

/** Nhóm gần nhất (Jaccard từ ≥ ngưỡng, hoặc trùng nguyên câu). null = tạo nhóm mới. */
export function findSimilarQuestion(
    candidates: { id: number; normalized: string; tokens: string[] }[],
    sig: { normalized: string; tokens: string[] },
    threshold = 0.6,
): number | null {
    let best: { id: number; s: number } | null = null;
    for (const c of candidates) {
        if (c.normalized === sig.normalized) return c.id;
        if (!c.tokens.length || !sig.tokens.length) continue;
        const s = jaccard(c.tokens, sig.tokens);
        if (s >= threshold && (!best || s > best.s)) best = { id: c.id, s };
    }
    return best ? best.id : null;
}

/** Chuyển trạng thái hợp lệ (đã duyệt / bỏ qua vẫn mở lại được). */
export function canTransition(from: LearningStatus, to: LearningStatus): boolean {
    if (from === to) return false;
    if (to === "approved") return from === "pending" || from === "processing";
    return true;
}

/** Từ khoá cho mục FAQ tạo từ một nhóm: các từ xuất hiện trong câu mẫu (tối đa 20). */
export function faqKeywords(samples: string[]): string[] {
    const count = new Map<string, number>();
    for (const s of samples) for (const t of new Set(tokenize(s))) count.set(t, (count.get(t) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t);
}
