// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — ngữ cảnh hội thoại gửi cho model (THUẦN, có test). Không gửi cả lịch sử: N tin gần nhất trong ngân sách
// ký tự, mỗi tin cắt ngắn, SĐT / email đã che. Tin phía page (sale, POS, AI) gộp nhãn "Shop".
// ═══════════════════════════════════════════════════════════════════
import type { ChatMessage } from "./types";
import { redactPii, truncate } from "./text";

const PER_MESSAGE_CHARS = 600;

/** Các dòng "Khách: …" / "Shop: …" của lịch sử TRƯỚC lượt hiện tại — mới nhất được giữ khi vượt ngân sách. */
export function historyLines(prior: ChatMessage[], maxMessages: number, maxChars: number): string[] {
    const out: string[] = [];
    let used = 0;
    for (let i = prior.length - 1; i >= 0 && out.length < maxMessages; i--) {
        const m = prior[i];
        const body = m.text ? truncate(redactPii(m.text).replace(/\s+/g, " ").trim(), PER_MESSAGE_CHARS) : (m.hasAttachment ? "[ảnh/tệp]" : "");
        if (!body) continue;
        const line = `${m.kind === "customer" ? "Khách" : "Shop"}: ${body}`;
        if (used + line.length > maxChars) break;
        out.unshift(line);
        used += line.length;
    }
    return out;
}

/** Chữ lượt khách hiện tại (đã che PII), mỗi tin một dòng. */
export function turnLines(turn: ChatMessage[]): string[] {
    return turn.map((m) => (m.text ? truncate(redactPii(m.text).trim(), 1500) : m.hasAttachment ? "[ảnh/tệp]" : "")).filter(Boolean);
}
