// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — Telegram Notifier. Bot API sendMessage (parse_mode HTML, chữ đã escape). Lỗi Telegram không làm hỏng
// lượt xử lý (router bắt lỗi); chống báo trùng nằm ở bảng ai_bot_notifications (reserveNotification). `fetch` tiêm vào.
// ═══════════════════════════════════════════════════════════════════
import type { EscalationPayload } from "./types";
import { escapeHtml, truncate } from "./text";
import type { FetchLike } from "./providers";

const API = "https://api.telegram.org";

export function formatEscalation(p: EscalationPayload): string {
    const lines = [
        `🆘 <b>AI cần Sale hỗ trợ</b>${p.mode === "shadow" ? " <i>(chế độ thử)</i>" : ""}`,
        `📄 Page: <b>${escapeHtml(p.pageName || p.pageId)}</b>${p.market ? ` · ${escapeHtml(p.market)}` : ""}`,
        `👤 Khách: ${escapeHtml(p.customerName || "(không tên)")} · hội thoại <code>${escapeHtml(p.conversationId)}</code>`,
        `❓ Khách hỏi: ${escapeHtml(truncate(p.question, 700))}`,
        `⚠️ Lý do: ${escapeHtml(p.reasonLabel)}`,
    ];
    if (p.context.length) lines.push(`🧾 Ngữ cảnh gần nhất:\n${escapeHtml(truncate(p.context.join("\n"), 900))}`);
    const links = [
        p.pancakeUrl ? `<a href="${escapeHtml(p.pancakeUrl)}">Mở trên Pancake</a>` : "",
        p.dashboardUrl ? `<a href="${escapeHtml(p.dashboardUrl)}">Mở trên dashboard</a>` : "",
    ].filter(Boolean);
    if (links.length) lines.push(`🔗 ${links.join(" · ")}`);
    return truncate(lines.join("\n"), 4000);
}

export type TelegramResult = { ok: boolean; error?: string; retryAfter?: number };

export async function sendTelegram(fetchFn: FetchLike, token: string, chatId: string, text: string, timeoutMs = 15_000): Promise<TelegramResult> {
    if (!token || !chatId) return { ok: false, error: "Chưa cấu hình Bot Token / Chat ID" };
    try {
        const res = await fetchFn(`${API}/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
            signal: AbortSignal.timeout(timeoutMs),
        } as RequestInit);
        const j = await res.json().catch(() => null);
        if (res.ok && j?.ok) return { ok: true };
        return {
            ok: false,
            error: `Telegram từ chối: ${j?.description || `HTTP ${res.status}`}`,
            retryAfter: j?.parameters?.retry_after ? Number(j.parameters.retry_after) : undefined,
        };
    } catch (e) {
        // Không lộ token: thông báo lỗi của fetch có thể chứa URL.
        const msg = (e instanceof Error ? e.message : String(e)).replace(token, "***");
        return { ok: false, error: /timeout|abort/i.test(msg) ? "Telegram không trả lời" : `Lỗi mạng Telegram: ${msg}` };
    }
}

/** Thử khoá: getMe → tên bot. */
export async function telegramGetMe(fetchFn: FetchLike, token: string, timeoutMs = 15_000): Promise<{ ok: boolean; detail: string }> {
    if (!token) return { ok: false, detail: "Chưa có Bot Token" };
    try {
        const res = await fetchFn(`${API}/bot${token}/getMe`, { signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
        const j = await res.json().catch(() => null);
        if (res.ok && j?.ok) return { ok: true, detail: `Bot @${j.result?.username || "?"}` };
        return { ok: false, detail: `Telegram từ chối: ${j?.description || `HTTP ${res.status}`}` };
    } catch (e) {
        return { ok: false, detail: "Không gọi được Telegram" };
    }
}
