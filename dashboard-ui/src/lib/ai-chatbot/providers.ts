// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — AI Provider (driver theo interface). DeepSeek + OpenAI (chuẩn chat/completions), Gemini (generateContent).
// Đổi provider / model ở AI Settings, không đụng nghiệp vụ. Có timeout, thử lại 429/5xx/hết giờ (giãn dần), đếm token,
// tính tiền theo bảng giá trong luật, giới hạn lượt/phút. `fetch` tiêm vào được → test giả lập timeout, JSON hỏng.
// Khoá KHÔNG nằm trên URL (Gemini dùng header x-goog-api-key) để không lọt vào log.
// ═══════════════════════════════════════════════════════════════════
import { AiError } from "./types";
import { costUsd, type Pricing, type ProviderName } from "./settings";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type ChatMessageIn = { role: "user" | "assistant"; content: string };

export type DriverChatInput = {
    apiKey: string; model: string; system: string; messages: ChatMessageIn[]; json: boolean;
    temperature: number; maxTokens: number; timeoutMs: number; fetch: FetchLike;
};
export type DriverChatOutput = { text: string; inputTokens: number; outputTokens: number; model: string };

export interface ProviderDriver {
    name: ProviderName;
    chat(i: DriverChatInput): Promise<DriverChatOutput>;
    listModels(apiKey: string, fetchFn: FetchLike, timeoutMs: number): Promise<string[]>;
}

export const PROVIDER_LABELS: Record<ProviderName, string> = { deepseek: "DeepSeek", openai: "OpenAI GPT", gemini: "Google Gemini" };
/** Tên khoá trong api_credentials (Khoá kết nối) của từng provider. Gemini dùng chung khoá "Hỏi AI" nếu không có khoá riêng. */
export const PROVIDER_KEY_VARS: Record<ProviderName, string[]> = {
    deepseek: ["AI_DEEPSEEK_API_KEY"],
    openai: ["AI_OPENAI_API_KEY"],
    gemini: ["AI_GEMINI_API_KEY", "GEMINI_API_KEY"],
};

async function fetchJson(fetchFn: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: any; headers: Headers }> {
    let res: Response;
    try {
        res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        if (/timeout|abort/i.test(msg)) throw new AiError("timeout", `AI không trả lời sau ${Math.round(timeoutMs / 1000)} giây`, true);
        throw new AiError("network", `Không kết nối được AI: ${msg}`, true);
    }
    const raw = await res.text().catch(() => "");
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (res.status === 429) throw new AiError("rate_limited", `AI báo quá giới hạn (429): ${errMsg(body, raw)}`, true, 429);
    if (res.status >= 500) throw new AiError("http", `AI lỗi máy chủ ${res.status}: ${errMsg(body, raw)}`, true, res.status);
    if (res.status === 401 || res.status === 403) throw new AiError("config", `Khoá AI bị từ chối (${res.status}): ${errMsg(body, raw)}`, false, res.status);
    if (!res.ok) throw new AiError("http", `AI trả lỗi ${res.status}: ${errMsg(body, raw)}`, false, res.status);
    if (body === null) throw new AiError("bad_response", "AI trả phản hồi không phải JSON", true, res.status);
    return { status: res.status, body, headers: res.headers };
}

function errMsg(body: any, raw: string): string {
    const m = body?.error?.message || body?.message || body?.error || raw;
    return String(typeof m === "string" ? m : JSON.stringify(m)).slice(0, 300);
}

/** OpenAI và DeepSeek cùng chuẩn /chat/completions. */
function openAiCompatible(name: "openai" | "deepseek", base: string): ProviderDriver {
    return {
        name,
        async chat(i) {
            const body: Record<string, unknown> = {
                model: i.model,
                messages: [{ role: "system", content: i.system }, ...i.messages],
            };
            // Model đời mới của OpenAI (gpt-5, o-series) không nhận max_tokens / temperature tuỳ ý.
            const modern = name === "openai" && !/^gpt-(3|4)/.test(i.model);
            if (modern) body.max_completion_tokens = i.maxTokens;
            else { body.max_tokens = i.maxTokens; body.temperature = i.temperature; }
            if (i.json) body.response_format = { type: "json_object" };
            const { body: j } = await fetchJson(i.fetch, `${base}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${i.apiKey}` },
                body: JSON.stringify(body),
            }, i.timeoutMs);
            const text = j?.choices?.[0]?.message?.content;
            if (typeof text !== "string") throw new AiError("bad_response", "AI không trả nội dung (choices rỗng)", true);
            return {
                text,
                inputTokens: Number(j?.usage?.prompt_tokens || 0),
                outputTokens: Number(j?.usage?.completion_tokens || 0),
                model: String(j?.model || i.model),
            };
        },
        async listModels(apiKey, fetchFn, timeoutMs) {
            const { body } = await fetchJson(fetchFn, `${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, timeoutMs);
            return ((body?.data || []) as { id: string }[]).map((m) => m.id).filter(Boolean).sort();
        },
    };
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_THINKING_HEADROOM = 2048;

const gemini: ProviderDriver = {
    name: "gemini",
    async chat(i) {
        const body = {
            systemInstruction: { parts: [{ text: i.system }] },
            contents: i.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
            generationConfig: {
                temperature: i.temperature,
                // Model Gemini đời mới (2.5+, 3.x) "suy nghĩ" trước khi trả lời và token suy nghĩ tính VÀO maxOutputTokens —
                // để đúng hạn câu trả lời là JSON bị cắt giữa chừng (đo 25/11/2026: gemini-3.5-flash trả '{"ok":').
                // Chừa thêm chỗ; chỉ trả tiền token thật dùng.
                maxOutputTokens: i.maxTokens + GEMINI_THINKING_HEADROOM,
                ...(i.json ? { responseMimeType: "application/json" } : {}),
            },
        };
        const { body: j } = await fetchJson(i.fetch, `${GEMINI_BASE}/models/${encodeURIComponent(i.model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": i.apiKey },
            body: JSON.stringify(body),
        }, i.timeoutMs);
        const parts = j?.candidates?.[0]?.content?.parts;
        // Bỏ phần "thought" (nếu model trả kèm) — chỉ lấy chữ trả lời.
        const text = Array.isArray(parts) ? parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("") : "";
        const finish = j?.candidates?.[0]?.finishReason;
        if (!text) {
            const why = finish || j?.promptFeedback?.blockReason || "rỗng";
            throw new AiError("bad_response", `Gemini không trả nội dung (${why})`, why !== "SAFETY");
        }
        const u = j?.usageMetadata || {};
        if (finish === "MAX_TOKENS") {
            const err = new AiError("bad_response", "Gemini hết hạn token giữa câu trả lời (MAX_TOKENS)", true);
            err.usage = { inputTokens: Number(u.promptTokenCount || 0), outputTokens: Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0) };
            throw err;
        }
        return {
            text,
            inputTokens: Number(u.promptTokenCount || 0),
            // Token suy nghĩ tính tiền như token trả lời.
            outputTokens: Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0),
            model: i.model,
        };
    },
    async listModels(apiKey, fetchFn, timeoutMs) {
        const { body } = await fetchJson(fetchFn, `${GEMINI_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } }, timeoutMs);
        return ((body?.models || []) as { name: string; supportedGenerationMethods?: string[] }[])
            .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
            .map((m) => m.name.replace(/^models\//, ""))
            .filter((id) => !/embed|image|imagen|tts|audio|veo|live|aqa/i.test(id))
            .sort();
    },
};

export const DRIVERS: Record<ProviderName, ProviderDriver> = {
    deepseek: openAiCompatible("deepseek", "https://api.deepseek.com"),
    openai: openAiCompatible("openai", "https://api.openai.com/v1"),
    gemini,
};

// ─── Giới hạn lượt / phút (trong tiến trình) ─────────────────────────

export class RateLimiter {
    private stamps: number[] = [];
    constructor(private rpm: number, private now: () => number = Date.now) {}
    setRpm(rpm: number) { this.rpm = Math.max(1, rpm); }
    /** ms phải chờ trước khi được gọi tiếp (0 = gọi ngay, đã ghi lượt). */
    take(): number {
        const t = this.now();
        this.stamps = this.stamps.filter((s) => t - s < 60_000);
        if (this.stamps.length < this.rpm) { this.stamps.push(t); return 0; }
        return 60_000 - (t - this.stamps[0]) + 5;
    }
}

const sleepReal = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CallOptions = {
    provider: ProviderName; model: string; apiKey: string; pricing: Pricing; maxRetries: number; timeoutMs: number;
    fetch: FetchLike; limiter?: RateLimiter; sleep?: (ms: number) => Promise<void>; now?: () => number;
};

/** Một lượt gọi model có thử lại (429 / 5xx / hết giờ / mạng: 0,5 s → 1,5 s → 4,5 s). Trả kèm token + tiền. */
export async function callModel(opts: CallOptions, input: { system: string; messages: ChatMessageIn[]; json: boolean; temperature: number; maxTokens: number }) {
    if (!opts.apiKey) throw new AiError("config", `Chưa có khoá ${PROVIDER_LABELS[opts.provider]} — nhập ở AI Settings`, false);
    const driver = DRIVERS[opts.provider];
    const sleep = opts.sleep || sleepReal;
    const now = opts.now || Date.now;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        if (opts.limiter) {
            const wait = opts.limiter.take();
            if (wait > 0) {
                if (wait > 20_000) throw new AiError("rate_limited", "Đã chạm giới hạn lượt gọi AI mỗi phút", true);
                await sleep(wait);
                opts.limiter.take();
            }
        }
        const t0 = now();
        try {
            const out = await driver.chat({ ...input, apiKey: opts.apiKey, model: opts.model, timeoutMs: opts.timeoutMs, fetch: opts.fetch });
            return {
                ...out,
                provider: opts.provider,
                latencyMs: now() - t0,
                costUsd: costUsd(opts.pricing, opts.provider, opts.model, out.inputTokens, out.outputTokens),
            };
        } catch (e) {
            lastErr = e;
            const retryable = e instanceof AiError ? e.retryable : true;
            if (!retryable || attempt === opts.maxRetries) break;
            await sleep(500 * Math.pow(3, attempt));
        }
    }
    throw lastErr instanceof Error ? lastErr : new AiError("http", String(lastErr), false);
}
