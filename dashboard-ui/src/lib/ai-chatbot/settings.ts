// ═══════════════════════════════════════════════════════════════════
// AI Chatbot — cài đặt (THUẦN, có test). Giá trị gốc ở config/talpha_rules.json → ai_chatbot (luật nghiệp vụ không gõ
// vào code); trang AI Settings lưu phần sửa vào bảng ai_bot_settings và PHỦ lên gốc. File này chỉ chuẩn hoá + kiểm:
// giá trị lạ / thiếu → về mức AN TOÀN (AI tắt, chế độ shadow), số bị kẹp vào khoảng hợp lệ.
// ═══════════════════════════════════════════════════════════════════

export const PROVIDERS = ["deepseek", "openai", "gemini"] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export type ModelChoice = { provider: ProviderName; model: string };
export type Pricing = Record<string, { input_per_m: number; output_per_m: number }>;

export type AiSettings = {
    enabled: boolean;
    mode: "shadow" | "live";
    live_test_conversations: string[];
    classifier: ModelChoice;
    generator: ModelChoice;
    temperature: number;
    max_tokens: number;
    classifier_max_tokens: number;
    confidence_threshold: number;
    min_retrieval_score: number;
    top_k: number;
    daily_cost_limit_usd: number;
    monthly_cost_limit_usd: number;
    provider_rpm: number;
    timeout_seconds: number;
    max_retries: number;
    debounce_seconds: number;
    pos_grace_seconds: number;
    sale_quiet_minutes: number;
    max_turn_age_minutes: number;
    escalation_pause_minutes: number;
    max_replies_per_conversation_hour: number;
    min_seconds_between_sends_page: number;
    poll_interval_seconds: number;
    max_attempts: number;
    context_messages: number;
    context_chars: number;
    max_answer_chars: number;
    price_max_age_hours: number;
    allow_partial_answers: boolean;
    /** Page ở chế độ tự động: tự chạy khi đủ điều kiện (đã gán nước, đọc được tin, không bị chặn, không có bot khác). */
    pages_auto: boolean;
    /** Thấy bot khác gửi trong chừng này giờ → AI né (hội thoại + page tự động). */
    other_bot_quiet_hours: number;
    /** Page lỗi đọc Pancake → nghỉ chừng này phút rồi tự thử lại. */
    page_error_backoff_minutes: number;
    respect_dashboard_assignment: boolean;
    respect_pancake_assignee: boolean;
    pause_tags: string[];
    tag_answered: string;
    tag_needs_help: string;
    own_sender_names: string[];
    persona: string;
    telegram: { enabled: boolean; chat_id: string; notify_in_shadow: boolean };
    webhook_enabled: boolean;
    /** IP nguồn được nhận webhook (Pancake chính thức: 203.171.22.6). Rỗng = không soát IP (chỉ soát chìa). */
    webhook_allowed_ips: string[];
    poll_enabled: boolean;
    kb_sync_hours: number;
    /** Link mở hội thoại trên Pancake trong tin Telegram — {page_id}, {conversation_id}. Dạng link CHƯA xác minh trong
     *  tài liệu chính thức → để trang sửa được. Rỗng = không gắn link Pancake. */
    pancake_url_template: string;
    pricing: Pricing;
    synonyms: Record<string, string[]>;
};

type NumSpec = { min: number; max: number; fallback: number; int?: boolean };

/** Khoảng hợp lệ + mức an toàn khi thiếu. Giá trị THẬT nằm ở talpha_rules.json → ai_chatbot. */
const NUMBERS: Record<string, NumSpec> = {
    temperature: { min: 0, max: 1.5, fallback: 0.2 },
    max_tokens: { min: 64, max: 4000, fallback: 600, int: true },
    classifier_max_tokens: { min: 64, max: 2000, fallback: 400, int: true },
    confidence_threshold: { min: 0, max: 1, fallback: 0.75 },
    min_retrieval_score: { min: 0, max: 1, fallback: 0.3 },
    top_k: { min: 1, max: 20, fallback: 6, int: true },
    daily_cost_limit_usd: { min: 0, max: 1000, fallback: 2 },
    monthly_cost_limit_usd: { min: 0, max: 10000, fallback: 30 },
    provider_rpm: { min: 1, max: 600, fallback: 30, int: true },
    timeout_seconds: { min: 5, max: 120, fallback: 30, int: true },
    max_retries: { min: 0, max: 5, fallback: 2, int: true },
    debounce_seconds: { min: 0, max: 300, fallback: 20, int: true },
    pos_grace_seconds: { min: 0, max: 600, fallback: 45, int: true },
    sale_quiet_minutes: { min: 0, max: 1440, fallback: 30, int: true },
    max_turn_age_minutes: { min: 1, max: 1440, fallback: 60, int: true },
    escalation_pause_minutes: { min: 0, max: 1440, fallback: 60, int: true },
    max_replies_per_conversation_hour: { min: 1, max: 60, fallback: 6, int: true },
    min_seconds_between_sends_page: { min: 0, max: 600, fallback: 20, int: true },
    poll_interval_seconds: { min: 10, max: 3600, fallback: 30, int: true },
    max_attempts: { min: 1, max: 10, fallback: 3, int: true },
    context_messages: { min: 2, max: 40, fallback: 12, int: true },
    context_chars: { min: 500, max: 20000, fallback: 4000, int: true },
    max_answer_chars: { min: 100, max: 4000, fallback: 1200, int: true },
    price_max_age_hours: { min: 1, max: 720, fallback: 24, int: true },
    kb_sync_hours: { min: 0, max: 168, fallback: 6, int: true },
    other_bot_quiet_hours: { min: 1, max: 720, fallback: 24, int: true },
    page_error_backoff_minutes: { min: 5, max: 1440, fallback: 30, int: true },
};

const BOOLS: Record<string, boolean> = {
    enabled: false,
    allow_partial_answers: true,
    pages_auto: true,
    respect_dashboard_assignment: true,
    respect_pancake_assignee: false,
    webhook_enabled: false,
    poll_enabled: true,
};

const SAFE_MODEL: ModelChoice = { provider: "deepseek", model: "deepseek-chat" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (v: unknown, max = 200): string[] =>
    Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, max) : [];

function modelChoice(v: unknown, fallback: ModelChoice, errors: string[], path: string): ModelChoice {
    if (!isObj(v)) return fallback;
    const provider = String(v.provider || "");
    const model = String(v.model || "").trim();
    if (!(PROVIDERS as readonly string[]).includes(provider)) {
        errors.push(`${path}.provider: phải là ${PROVIDERS.join(" / ")}`);
        return fallback;
    }
    if (!model || model.length > 120 || !/^[\w.:\-/]+$/.test(model)) {
        errors.push(`${path}.model: tên model không hợp lệ`);
        return fallback;
    }
    return { provider: provider as ProviderName, model };
}

function pricing(v: unknown): Pricing {
    const out: Pricing = {};
    if (!isObj(v)) return out;
    for (const [k, p] of Object.entries(v)) {
        if (k.startsWith("_") || !isObj(p)) continue;
        const i = Number(p.input_per_m), o = Number(p.output_per_m);
        if (Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) out[k] = { input_per_m: i, output_per_m: o };
    }
    return out;
}

/**
 * Gốc (config) + phần sửa (DB) → cài đặt dùng được. `errors` chỉ báo lỗi của PHẦN SỬA (để trang báo người dùng);
 * trường lỗi giữ giá trị gốc.
 */
export function normalizeSettings(base: unknown, override: unknown = {}): { settings: AiSettings; errors: string[] } {
    const errors: string[] = [];
    const b = isObj(base) ? base : {};
    const o = isObj(override) ? override : {};
    const pick = (k: string) => (k in o ? o[k] : b[k]);
    const fromOverride = (k: string) => k in o;

    const num = (k: string): number => {
        const spec = NUMBERS[k];
        const read = (v: unknown) => (v === "" || v === null || v === undefined ? NaN : Number(v));
        let v = read(pick(k));
        if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
            if (fromOverride(k)) errors.push(`${k}: phải trong khoảng ${spec.min}..${spec.max}`);
            v = read(b[k]);
            if (!Number.isFinite(v) || v < spec.min || v > spec.max) v = spec.fallback;
        }
        return spec.int ? Math.round(v) : v;
    };
    const bool = (k: string): boolean => {
        const v = pick(k);
        if (typeof v === "boolean") return v;
        if (fromOverride(k) && v !== undefined) errors.push(`${k}: phải là true/false`);
        return typeof b[k] === "boolean" ? (b[k] as boolean) : BOOLS[k];
    };
    const str = (k: string, fallback: string, max = 2000): string => {
        const v = pick(k);
        if (typeof v === "string" && v.trim().length <= max) return v.trim() || fallback;
        if (fromOverride(k) && v !== undefined) errors.push(`${k}: chuỗi quá dài hoặc sai kiểu`);
        return typeof b[k] === "string" ? String(b[k]).trim() || fallback : fallback;
    };

    const modeRaw = String(pick("mode") || "");
    if (fromOverride("mode") && !["shadow", "live"].includes(modeRaw)) errors.push("mode: phải là shadow hoặc live");
    const mode: "shadow" | "live" = modeRaw === "live" ? "live" : "shadow";

    const baseClassifier = modelChoice(b.classifier, SAFE_MODEL, [], "classifier");
    const baseGenerator = modelChoice(b.generator, SAFE_MODEL, [], "generator");
    const tg = isObj(pick("telegram")) ? (pick("telegram") as Record<string, unknown>) : {};
    const tgBase = isObj(b.telegram) ? b.telegram : {};
    const chatId = String(tg.chat_id ?? tgBase.chat_id ?? "").trim();
    if (chatId && !/^-?\d{3,20}$|^@[\w]{4,64}$/.test(chatId)) errors.push("telegram.chat_id: phải là số (vd -100…) hoặc @tên_kênh");

    const settings: AiSettings = {
        enabled: bool("enabled"),
        mode,
        live_test_conversations: strList(pick("live_test_conversations"), 500),
        classifier: fromOverride("classifier") ? modelChoice(o.classifier, baseClassifier, errors, "classifier") : baseClassifier,
        generator: fromOverride("generator") ? modelChoice(o.generator, baseGenerator, errors, "generator") : baseGenerator,
        temperature: num("temperature"),
        max_tokens: num("max_tokens"),
        classifier_max_tokens: num("classifier_max_tokens"),
        confidence_threshold: num("confidence_threshold"),
        min_retrieval_score: num("min_retrieval_score"),
        top_k: num("top_k"),
        daily_cost_limit_usd: num("daily_cost_limit_usd"),
        monthly_cost_limit_usd: num("monthly_cost_limit_usd"),
        provider_rpm: num("provider_rpm"),
        timeout_seconds: num("timeout_seconds"),
        max_retries: num("max_retries"),
        debounce_seconds: num("debounce_seconds"),
        pos_grace_seconds: num("pos_grace_seconds"),
        sale_quiet_minutes: num("sale_quiet_minutes"),
        max_turn_age_minutes: num("max_turn_age_minutes"),
        escalation_pause_minutes: num("escalation_pause_minutes"),
        max_replies_per_conversation_hour: num("max_replies_per_conversation_hour"),
        min_seconds_between_sends_page: num("min_seconds_between_sends_page"),
        poll_interval_seconds: num("poll_interval_seconds"),
        max_attempts: num("max_attempts"),
        context_messages: num("context_messages"),
        context_chars: num("context_chars"),
        max_answer_chars: num("max_answer_chars"),
        price_max_age_hours: num("price_max_age_hours"),
        allow_partial_answers: bool("allow_partial_answers"),
        pages_auto: bool("pages_auto"),
        other_bot_quiet_hours: num("other_bot_quiet_hours"),
        page_error_backoff_minutes: num("page_error_backoff_minutes"),
        respect_dashboard_assignment: bool("respect_dashboard_assignment"),
        respect_pancake_assignee: bool("respect_pancake_assignee"),
        pause_tags: strList(pick("pause_tags"), 50),
        tag_answered: str("tag_answered", "Bot AI", 60),
        tag_needs_help: str("tag_needs_help", "Bot AI - Cần hỗ trợ", 60),
        own_sender_names: strList(pick("own_sender_names"), 20),
        persona: str("persona", "", 3000),
        telegram: {
            enabled: typeof tg.enabled === "boolean" ? tg.enabled : tgBase.enabled === true,
            chat_id: chatId,
            notify_in_shadow: typeof tg.notify_in_shadow === "boolean" ? tg.notify_in_shadow : tgBase.notify_in_shadow === true,
        },
        webhook_enabled: bool("webhook_enabled"),
        webhook_allowed_ips: strList(pick("webhook_allowed_ips"), 20),
        poll_enabled: bool("poll_enabled"),
        kb_sync_hours: num("kb_sync_hours"),
        pancake_url_template: (() => {
            const v = str("pancake_url_template", "", 300);
            if (v && !/^https:\/\/[\w.-]+\//.test(v)) { errors.push("pancake_url_template: phải bắt đầu bằng https://"); return ""; }
            return v;
        })(),
        // Bảng giá + từ đồng nghĩa chỉ đọc từ config (không sửa trên trang).
        pricing: pricing(b.pricing),
        synonyms: isObj(b.synonyms)
            ? Object.fromEntries(Object.entries(b.synonyms).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, strList(v, 30)]))
            : {},
    };
    if (settings.tag_answered === settings.tag_needs_help) errors.push("tag_answered và tag_needs_help phải khác nhau");
    if (settings.monthly_cost_limit_usd < settings.daily_cost_limit_usd) {
        errors.push("monthly_cost_limit_usd phải ≥ daily_cost_limit_usd");
    }
    return { settings, errors };
}

/** Khoá được sửa trên trang (phần còn lại — bảng giá, từ đồng nghĩa — chỉ ở config). */
export const EDITABLE_KEYS = [
    "enabled", "mode", "live_test_conversations", "classifier", "generator", "temperature", "max_tokens",
    "classifier_max_tokens", "confidence_threshold", "min_retrieval_score", "top_k", "daily_cost_limit_usd",
    "monthly_cost_limit_usd", "provider_rpm", "timeout_seconds", "max_retries", "debounce_seconds", "pos_grace_seconds",
    "sale_quiet_minutes", "max_turn_age_minutes", "escalation_pause_minutes", "max_replies_per_conversation_hour",
    "min_seconds_between_sends_page", "poll_interval_seconds", "max_attempts", "context_messages", "context_chars",
    "max_answer_chars", "price_max_age_hours", "allow_partial_answers", "pages_auto", "other_bot_quiet_hours",
    "page_error_backoff_minutes", "respect_dashboard_assignment",
    "respect_pancake_assignee", "pause_tags", "tag_answered", "tag_needs_help", "own_sender_names", "persona", "telegram",
    "webhook_enabled", "webhook_allowed_ips", "poll_enabled", "kb_sync_hours", "pancake_url_template",
] as const;

/** Chỉ giữ khoá sửa được — trang gửi thừa khoá (pricing…) thì bỏ. */
export function pickEditable(o: unknown): Record<string, unknown> {
    if (!isObj(o)) return {};
    return Object.fromEntries(Object.entries(o).filter(([k]) => (EDITABLE_KEYS as readonly string[]).includes(k)));
}

/** Giá (USD) của một lượt gọi theo bảng giá. Model không có trong bảng → dòng "*" (đặt cao để trần chi phí chặn sớm). */
export function costUsd(p: Pricing, provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const row = p[`${provider}:${model}`] || p[`${provider}:*`] || p["*"] || { input_per_m: 1, output_per_m: 3 };
    return (inputTokens * row.input_per_m + outputTokens * row.output_per_m) / 1_000_000;
}

/** Lượt này có được GỬI thật không: chế độ live + (không giới hạn hội thoại thử, hoặc hội thoại nằm trong danh sách). */
export function canSendLive(s: AiSettings, conversationId: string): boolean {
    if (s.mode !== "live") return false;
    return s.live_test_conversations.length === 0 || s.live_test_conversations.includes(conversationId);
}
