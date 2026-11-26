// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — chấm độ tin cậy cuối (THUẦN, có test). Gộp: tự đánh giá của model sinh câu trả lời, độ khớp kiến thức,
// độ chắc của bộ phân loại, ngôn ngữ. Cổng cứng: soát câu trả lời có lỗi → 0; nghi prompt injection → tối đa 0,5.
// Dưới ngưỡng `confidence_threshold` → chuyển Sale.
// ═══════════════════════════════════════════════════════════════════
import type { Classification, GeneratedAnswer } from "./types";

export type ConfidenceInput = {
    classification: Classification;
    generated: GeneratedAnswer;
    /** Điểm truy xuất cao nhất của từng câu hỏi ĐƯỢC trả lời. */
    retrievalScores: number[];
    checkProblems: string[];
    answeredQuestions: number;
    totalQuestions: number;
};

export type ConfidenceResult = { score: number; parts: Record<string, number> };

export function evaluateConfidence(i: ConfidenceInput): ConfidenceResult {
    const retrieval = i.retrievalScores.length ? i.retrievalScores.reduce((a, b) => a + b, 0) / i.retrievalScores.length : 0;
    const coverage = i.totalQuestions ? i.answeredQuestions / i.totalQuestions : 0;
    const parts = {
        model: i.generated.confidence,
        retrieval: Math.min(1, retrieval * 1.25),          // 0,8 khớp đã là rất chắc
        classifier: i.classification.confidence,
        coverage,
    };
    let score = 0.4 * parts.model + 0.3 * parts.retrieval + 0.15 * parts.classifier + 0.15 * parts.coverage;
    if (i.checkProblems.length) score = 0;
    if (i.classification.injectionSuspected) score = Math.min(score, 0.5);
    if (i.classification.source === "fallback") score = Math.min(score, 0.7);
    return { score: Math.round(score * 1000) / 1000, parts };
}
