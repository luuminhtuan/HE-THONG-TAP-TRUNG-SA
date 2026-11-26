// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — nhãn tiếng Việt của mã lý do (THUẦN; giao diện, Telegram, log cùng đọc). Mã lý do có thể kèm đuôi
// ":<chi tiết>" (vd "already_handled:pos_auto", "pos_rule:3") — nhãn tra theo phần trước dấu ":".
// ═══════════════════════════════════════════════════════════════════

export const REASON_LABELS: Record<string, string> = {
    answered: "AI đã trả lời",
    answered_partial: "AI trả lời một phần — phần còn lại chuyển Sale",
    shadow_mode: "Chế độ thử (shadow) — chỉ ghi, không gửi",
    not_in_live_test_list: "Hội thoại ngoài danh sách thử — chỉ ghi, không gửi",
    already_handled: "Đã có người / luật tự động trả lời",
    handled_during_processing: "Có người / luật tự động trả lời trong lúc AI soạn",
    too_old: "Tin khách đã quá cũ",
    paused: "AI đang tạm dừng ở hội thoại này",
    sale_assigned_dashboard: "Hội thoại đã gán Sale trên dashboard",
    sale_assigned_pancake: "Hội thoại đã gán Sale trên Pancake",
    pause_tag: "Hội thoại mang tag tắt AI",
    sale_active: "Sale vừa nhắn trong hội thoại",
    pos_rule: "Luật POS xử lý tin này",
    greeting_only: "Chỉ chào hỏi — để POS / Sale",
    non_text: "Tin không có chữ (ảnh / tệp / giọng nói)",
    budget_exceeded: "Đã chạm trần chi phí AI",
    reply_limit: "AI đã trả lời quá nhiều lượt trong giờ",
    intent: "Khách cần Sale (đặt hàng / khiếu nại / gặp người)",
    suspicious_input: "Tin nghi tấn công prompt",
    no_knowledge: "Không có dữ liệu để trả lời",
    no_knowledge_partial: "Thiếu dữ liệu cho một phần câu hỏi",
    generation_invalid: "AI trả kết quả không hợp lệ",
    answer_rejected: "Câu trả lời bị chặn khi soát (thiếu căn cứ / lộ thông tin)",
    low_confidence: "Độ tin cậy thấp",
    ai_error: "Lỗi gọi AI",
    recheck_failed: "Không đọc lại được hội thoại trước khi gửi",
    no_page_token: "Page chưa có token page — không gửi được",
    send_failed: "Pancake từ chối gửi tin",
    send_unknown: "Không rõ tin đã gửi chưa (hết giờ chờ) — Sale kiểm tra",
    internal_error: "Lỗi hệ thống",
    ai_disabled: "AI đang tắt",
    ai_disabled_during_processing: "AI bị tắt trong lúc soạn",
    page_disabled: "Page chưa bật AI",
    conversation_info_unavailable: "Không đọc được tag / người phụ trách hội thoại — không gửi",
    send_in_progress: "Lượt này đang được gửi ở nơi khác",
    answered_recovered: "AI đã gửi (ghi bù nhật ký)",
    job_failed: "Xử lý hỏng sau nhiều lần thử — không gửi gì",
    other_bot_active: "Hội thoại đang có bot khác trả lời (vd bot AI Sale cũ) — AI né",
};

export function reasonLabel(reason: string | null | undefined): string {
    const r = String(reason || "");
    const key = r.split(":")[0];
    const base = REASON_LABELS[r] || REASON_LABELS[key] || r || "—";
    const tail = r.includes(":") ? r.slice(r.indexOf(":") + 1) : "";
    return tail && !REASON_LABELS[r] ? `${base} (${tail})` : base;
}

export const DECISION_LABELS: Record<string, string> = {
    answered: "Đã trả lời",
    shadow: "Thử (không gửi)",
    escalated: "Chuyển Sale",
    skipped: "Bỏ qua",
    error: "Lỗi",
};

/** Lý do chuyển Sale nên đưa câu hỏi vào AI Learning (thiếu kiến thức — trả lời chuẩn một lần là AI học được). */
export const LEARNABLE_REASONS = new Set([
    "no_knowledge", "no_knowledge_partial", "low_confidence", "generation_invalid", "answer_rejected", "answered_partial",
]);
