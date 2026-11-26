import crypto from "crypto";
import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import { getCredential, saveCredential } from "@/lib/talpha/credentials";
import { maskCredential } from "@/lib/talpha/credential-utils";
import { PANCAKE_TOKEN_VARS } from "@/lib/talpha/pancake";
import {
    getSettingsOverride, listPosRules, parsePosRule, savePosRule, saveSettingsOverride, setPageMode,
} from "@/lib/ai-chatbot/admin-store";
import { PAGE_STATUS_LABELS } from "@/lib/ai-chatbot/page-policy";
import { normalizeSettings, pickEditable, PROVIDERS, type ProviderName } from "@/lib/ai-chatbot/settings";
import { DRIVERS, PROVIDER_KEY_VARS, PROVIDER_LABELS } from "@/lib/ai-chatbot/providers";
import { PANCAKE_PUBLIC_V1 } from "@/lib/ai-chatbot/pancake-client";
import { sendTelegram, telegramGetMe } from "@/lib/ai-chatbot/telegram";
import {
    aiPort, baseSettings, invalidateSettings, loadSettings, pageTokenVar, providerKey, runtime, syncPageTokens, TELEGRAM_TOKEN_VAR,
    WEBHOOK_SECRET_VAR,
} from "@/lib/ai-chatbot/runtime";
import { tickOnce, workerStatus } from "@/lib/ai-chatbot/worker";
import { bad, ok, readJson, scopeOf, serverError } from "@/lib/ai-chatbot/route-helpers";

export const dynamic = "force-dynamic";

// AI Chatbot → Cài đặt (CHỈ giám đốc — API_RULES). GET = cài đặt đang chạy + phần sửa + page + luật POS + trạng thái khoá
// (đã che) + worker. PUT = lưu phần sửa (kiểm lỗi, sai → 400, không lưu gì). POST {action} = các nút trên trang.
// Khoá AI / Telegram / token page / chìa webhook lưu ở api_credentials (MÃ HOÁ) — gọi thử trước rồi mới lưu.
const KEY_KINDS: Record<string, string> = {
    deepseek: PROVIDER_KEY_VARS.deepseek[0], openai: PROVIDER_KEY_VARS.openai[0], gemini: PROVIDER_KEY_VARS.gemini[0], telegram: TELEGRAM_TOKEN_VAR,
};

const SECRET_ACTIONS = new Set(["save_key", "delete_key", "save_page_token", "delete_page_token", "read_page_tokens", "rotate_webhook_secret",
    "reveal_webhook_url", "set_page", "save_rule"]);

function keyStatus(name: string, fallback?: string) {
    const v = getCredential(name);
    const fb = !v && fallback ? getCredential(fallback) : "";
    return { has: !!(v || fb), masked: maskCredential(v || fb), via: v ? name : fb ? fallback : null };
}

/** URL webhook. `reveal` = false → chìa bị che (GET trả bản che; bản đầy đủ chỉ qua nút "Hiện URL" của người đăng nhập). */
function webhookUrl(reveal = false): string | null {
    const secret = getCredential(WEBHOOK_SECRET_VAR);
    if (!secret) return null;
    const host = (process.env.DASHBOARD_HTTPS_HOST || "").trim();
    return `${host ? `https://${host}` : "https://<địa chỉ dashboard>"}/api/webhooks/pancake?key=${reveal ? secret : maskCredential(secret)}`;
}

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const scope = scopeOf(a);
    try {
        const S = await loadSettings(true);
        const [override, allPages, rules, queue, kb] = await Promise.all([
            getSettingsOverride(query), runtime().pg.queue.allPages(), listPosRules(query),
            query(`SELECT status, count(*)::int AS n FROM ai_bot_jobs WHERE status IN ('pending', 'running') GROUP BY 1`),
            query(`SELECT count(*) FILTER (WHERE source = 'pos_sync')::int AS products, count(*) FILTER (WHERE source <> 'pos_sync')::int AS other
                FROM ai_kb_entries WHERE enabled AND deleted_at IS NULL`),
        ]);
        const pages = allPages.filter((p) => scope.full || (p.market && scope.codes.includes(p.market)));
        const running = pages.filter((p) => p.enabled).length;
        const accountTokens = PANCAKE_TOKEN_VARS.filter((v) => !!getCredential(v)).length;
        const usedProviders = [...new Set([S.classifier.provider, S.generator.provider])];
        // Việc cần làm — tính sẵn để trang hiện một danh sách ngắn thay vì bắt người dùng tự dò từng mục.
        const checklist = [
            { key: "ai_key", ok: usedProviders.every((p) => !!providerKey(p)), label: `Khoá AI cho ${usedProviders.join(" + ")}` },
            { key: "pancake", ok: accountTokens > 0, label: "Token tài khoản Pancake (Quản trị → Khoá kết nối) — token page tự đọc từ đây" },
            { key: "pages", ok: running > 0, label: `Page đang chạy: ${running}/${pages.length} (tự động — xem bảng Page nếu thiếu)` },
            { key: "kb", ok: (kb[0]?.products || 0) + (kb[0]?.other || 0) > 0, label: `Kiến thức: ${kb[0]?.products || 0} sản phẩm POS + ${kb[0]?.other || 0} mục khác` },
            { key: "telegram", ok: !!S.telegram.enabled && !!S.telegram.chat_id && !!getCredential(TELEGRAM_TOKEN_VAR), label: "Telegram báo Sale (tuỳ chọn)" },
            { key: "enabled", ok: S.enabled, label: S.enabled ? `AI đang bật (${S.mode === "live" ? "gửi thật" : "shadow — chưa gửi"})` : "Bật công tắc tổng" },
        ];
        return ok({
            settings: S,
            override,
            base: normalizeSettings(baseSettings(), {}).settings,
            checklist,
            pages: pages.map((p) => ({
                page_id: p.pageId, name: p.name, market: p.market, mode: p.mode, enabled: p.enabled, status: p.status,
                status_label: PAGE_STATUS_LABELS[p.status], has_page_token: p.hasPageToken, last_poll_at: p.lastPollAt ? new Date(p.lastPollAt).toISOString() : null,
                health_detail: p.health === "error" ? p.healthDetail : null,
            })),
            pos_rules: rules,
            providers: PROVIDERS.map((p) => ({ id: p, label: PROVIDER_LABELS[p] })),
            keys: {
                deepseek: keyStatus(PROVIDER_KEY_VARS.deepseek[0]),
                openai: keyStatus(PROVIDER_KEY_VARS.openai[0]),
                gemini: keyStatus(PROVIDER_KEY_VARS.gemini[0], PROVIDER_KEY_VARS.gemini[1]),
                telegram: keyStatus(TELEGRAM_TOKEN_VAR),
            },
            account_tokens: accountTokens,
            webhook_url: webhookUrl(),
            worker: workerStatus(),
            queue: Object.fromEntries(queue.map((r) => [r.status, r.n])),
        });
    } catch (e) {
        return serverError(e, "settings GET");
    }
}

export async function PUT(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    // Chìa nội bộ (data/.internal_token) không được bật AI / chuyển live — chỉ người đăng nhập (cùng luật cài đặt chấm công).
    if (!a.full || a.kind === "internal") return bad("Chỉ giám đốc (đăng nhập) sửa cài đặt AI", 403);
    const scope = scopeOf(a);
    try {
        const b = await readJson(req);
        const patch = pickEditable(b?.settings ?? b);
        const cur = (await getSettingsOverride(query)).settings as Record<string, unknown>;
        const merged = { ...cur, ...patch };
        const { settings, errors } = normalizeSettings(baseSettings(), merged);
        if (errors.length) return bad(errors);
        await saveSettingsOverride(query, scope, merged);
        invalidateSettings();
        await loadSettings(true);
        console.log(`[ai-chatbot] ${scope.actor} lưu cài đặt: ${Object.keys(patch).join(", ")} → enabled=${settings.enabled} mode=${settings.mode}`);
        return ok({ ok: true, settings });
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        return serverError(e, "settings PUT");
    }
}

async function verifyPageToken(pageId: string, token: string): Promise<string | null> {
    try {
        const r = await fetch(`${PANCAKE_PUBLIC_V1}/pages/${encodeURIComponent(pageId)}/tags?page_access_token=${encodeURIComponent(token)}`,
            { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.success === false) return `Pancake từ chối token: ${j?.message || `HTTP ${r.status}`}`;
        return null;
    } catch (e) {
        return "Không gọi được Pancake để thử token";
    }
}

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    if (!a.full) return bad("Chỉ giám đốc thao tác cài đặt AI", 403);
    const scope = scopeOf(a);
    try {
        const b = await readJson(req);
        const action = String(b?.action || "");
        // Khoá / token / chìa webhook: chỉ NGƯỜI đăng nhập — không chìa nội bộ, không chế độ public (cùng luật credentials/reveal).
        if (a.kind !== "user" && SECRET_ACTIONS.has(action)) return bad("Thao tác với khoá chỉ người dùng đăng nhập làm được", 403);
        const pageId = String(b?.page_id || "");
        const pageOk = /^[\w.:-]{1,80}$/.test(pageId);

        if (action === "set_page") {
            if (!pageOk) return bad("page_id không hợp lệ");
            const mode = b.mode ? String(b.mode) : b.enabled === true ? "on" : b.enabled === false ? "off" : "";
            if (!["auto", "on", "off"].includes(mode)) return bad("Chế độ page phải là auto / on / off");
            const [p] = await query("SELECT page_id FROM pancake_pages WHERE page_id = @pageId", { pageId });
            if (!p) return bad("Page không có trong hộp thư Pancake (bảng pancake_pages)", 404);
            await setPageMode(query, scope, pageId, mode as "auto" | "on" | "off", b.note ? String(b.note).slice(0, 300) : null);
            return ok({ ok: true });
        }
        if (action === "save_key") {
            const name = KEY_KINDS[String(b.kind)];
            const value = String(b.value || "").trim();
            if (!name) return bad("Loại khoá không hợp lệ");
            if (value.length < 10 || value.length > 500) return bad("Khoá không hợp lệ");
            if (b.kind === "telegram") {
                const t = await telegramGetMe((u, i) => fetch(u, i), value);
                if (!t.ok) return bad(t.detail);
                await saveCredential(name, value, `${t.detail} · ${new Date().toISOString().slice(0, 10)}`, scope.actor);
                return ok({ ok: true, detail: t.detail });
            }
            const models = await DRIVERS[b.kind as ProviderName].listModels(value, (u, i) => fetch(u, i), 20_000).catch((e: Error) => e);
            if (models instanceof Error) return bad(`Khoá bị từ chối: ${models.message}`);
            await saveCredential(name, value, `${models.length} model · ${new Date().toISOString().slice(0, 10)}`, scope.actor);
            return ok({ ok: true, detail: `Gọi được — ${models.length} model`, models: models.slice(0, 200) });
        }
        if (action === "delete_key") {
            const name = KEY_KINDS[String(b.kind)];
            if (!name) return bad("Loại khoá không hợp lệ");
            await saveCredential(name, null, "", scope.actor);
            return ok({ ok: true });
        }
        if (action === "list_models") {
            const p = String(b.provider) as ProviderName;
            if (!PROVIDERS.includes(p)) return bad("provider không hợp lệ");
            const key = providerKey(p);
            if (!key) return bad(`Chưa có khoá ${PROVIDER_LABELS[p]}`);
            return ok({ models: await DRIVERS[p].listModels(key, (u, i) => fetch(u, i), 20_000) });
        }
        if (action === "test_provider") {
            const target = b.target === "classifier" ? "classify" : "generate";
            const S = await loadSettings(true);
            const t0 = Date.now();
            const r = await aiPort(() => S, { purposeOverride: "test" }).chat({
                purpose: target, json: true, temperature: 0, maxTokens: 60,
                system: "You are a connection test. Reply with ONLY this JSON: {\"ok\": true, \"lang\": \"vi\"}",
                messages: [{ role: "user", content: "Kiểm tra kết nối. Trả JSON." }],
            });
            return ok({ ok: true, provider: r.provider, model: r.model, latency_ms: Date.now() - t0, tokens: r.inputTokens + r.outputTokens,
                cost_usd: r.costUsd, sample: r.text.slice(0, 200) });
        }
        if (action === "test_telegram") {
            const S = await loadSettings(true);
            const token = getCredential(TELEGRAM_TOKEN_VAR);
            const chatId = String(b.chat_id || S.telegram.chat_id || "");
            const me = await telegramGetMe((u, i) => fetch(u, i), token);
            if (!me.ok) return bad(me.detail);
            const r = await sendTelegram((u, i) => fetch(u, i), token, chatId, `✅ <b>Thử kết nối AI Chatbot</b>\n${me.detail} gửi được vào nhóm này.`);
            return r.ok ? ok({ ok: true, detail: `${me.detail} → đã gửi tin thử` }) : bad(r.error || "Telegram từ chối");
        }
        if (action === "save_page_token") {
            const token = String(b.token || "").trim();
            if (!pageOk || token.length < 10 || token.length > 1000) return bad("page_id / token không hợp lệ");
            const err = await verifyPageToken(pageId, token);
            if (err) return bad(err);
            await saveCredential(pageTokenVar(pageId), token, `token page ${pageId}`, scope.actor);
            return ok({ ok: true });
        }
        if (action === "delete_page_token") {
            if (!pageOk) return bad("page_id không hợp lệ");
            await saveCredential(pageTokenVar(pageId), null, "", scope.actor);
            return ok({ ok: true });
        }
        if (action === "read_page_tokens") {
            // Cùng hàm worker chạy mỗi 30 phút: đọc token page CÓ SẴN (không sinh mới), lưu khi page chưa có / token đổi.
            const r = await syncPageTokens(scope.actor);
            return ok({ ok: true, ...r, note: r.found === 0 ? "Không đọc được token page nào — tài khoản Pancake phải là ADMIN của page" : undefined });
        }
        if (action === "rotate_webhook_secret") {
            await saveCredential(WEBHOOK_SECRET_VAR, crypto.randomBytes(24).toString("hex"), "chìa webhook Pancake", scope.actor);
            return ok({ ok: true, webhook_url: webhookUrl(true) });
        }
        if (action === "reveal_webhook_url") {
            return ok({ ok: true, webhook_url: webhookUrl(true) });
        }
        if (action === "save_rule") {
            const parsed = parsePosRule(b);
            if (!parsed.ok) return bad(parsed.error);
            const id = await savePosRule(query, scope, b.id ? Number(b.id) : null, parsed.value);
            return id ? ok({ ok: true, id }) : bad("Không có luật này", 404);
        }
        if (action === "run_now") {
            return ok({ ok: true, ...(await tickOnce()) });
        }
        if (action === "sync_status") {
            return ok({ worker: workerStatus(), runtime: !!runtime() });
        }
        return bad("action không hợp lệ");
    } catch (e: any) {
        if (e?.status) return bad(e.message, e.status);
        if (e?.name === "AiError") return bad(e.message, 502);
        return serverError(e, "settings POST");
    }
}
