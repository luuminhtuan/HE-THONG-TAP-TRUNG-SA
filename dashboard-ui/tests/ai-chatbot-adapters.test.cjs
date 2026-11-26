// node tests/ai-chatbot-adapters.test.cjs (chạy qua npm test)
// AI Chatbot — bộ chuyển đổi gọi mạng, với fetch GIẢ: Provider AI (DeepSeek / OpenAI / Gemini), Pancake client, Telegram.
// Không gọi mạng thật, không gửi tin thật.
const assert = require("assert");
const B = "../.test-build/ai-chatbot/";
const PV = require(B + "providers.js");
const PC = require(B + "pancake-client.js");
const TG = require(B + "telegram.js");
const TY = require(B + "types.js");

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body });
const noSleep = async () => {};
function fakeFetch(handlers) {
    const calls = [];
    const f = async (url, init = {}) => {
        calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
        const h = handlers.shift();
        if (!h) throw new Error("không còn phản hồi giả");
        if (h instanceof Error) throw h;
        return typeof h === "function" ? h(url, init) : h;
    };
    f.calls = calls;
    return f;
}
const pricing = { "deepseek:deepseek-chat": { input_per_m: 0.28, output_per_m: 0.42 }, "*": { input_per_m: 1, output_per_m: 3 } };
const opts = (fetch, o = {}) => ({ provider: "deepseek", model: "deepseek-chat", apiKey: "sk-test", pricing, maxRetries: 2, timeoutMs: 1000, fetch, sleep: noSleep, ...o });
const input = { system: "Trả JSON", messages: [{ role: "user", content: "hi" }], json: true, temperature: 0.2, maxTokens: 100 };
const okChat = (text = "{\"a\":1}") => res(200, { choices: [{ message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 500 }, model: "deepseek-chat" });

const tests = [];
const t = (n, f) => tests.push([n, f]);

t("Provider: DeepSeek gọi /chat/completions, JSON mode, đếm token + tiền", async () => {
    const f = fakeFetch([okChat()]);
    const r = await PV.callModel(opts(f), input);
    assert.strictEqual(f.calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.strictEqual(f.calls[0].init.headers.Authorization, "Bearer sk-test");
    assert.deepStrictEqual(f.calls[0].body.response_format, { type: "json_object" });
    assert.strictEqual(f.calls[0].body.messages[0].role, "system");
    assert.strictEqual(r.inputTokens, 1000);
    assert.ok(Math.abs(r.costUsd - (1000 * 0.28 + 500 * 0.42) / 1e6) < 1e-12);
});
t("Provider: 429 → thử lại rồi thành công", async () => {
    const f = fakeFetch([res(429, { error: { message: "rate" } }), okChat()]);
    const r = await PV.callModel(opts(f), input);
    assert.strictEqual(f.calls.length, 2);
    assert.strictEqual(r.text, "{\"a\":1}");
});
t("Provider: timeout mọi lần → AiError timeout (thử đủ maxRetries)", async () => {
    const err = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const f = fakeFetch([err, err, err]);
    await assert.rejects(PV.callModel(opts(f), input), (e) => e instanceof TY.AiError && e.code === "timeout");
    assert.strictEqual(f.calls.length, 3);
});
t("Provider: 401 khoá sai → KHÔNG thử lại", async () => {
    const f = fakeFetch([res(401, { error: { message: "invalid key" } })]);
    await assert.rejects(PV.callModel(opts(f), input), (e) => e.code === "config" && !e.retryable);
    assert.strictEqual(f.calls.length, 1);
});
t("Provider: chưa có khoá → lỗi cấu hình, không gọi mạng", async () => {
    const f = fakeFetch([]);
    await assert.rejects(PV.callModel(opts(f, { apiKey: "" }), input), (e) => e.code === "config");
});
t("Provider: Gemini — khoá ở header, không nằm trên URL; JSON mime", async () => {
    const f = fakeFetch([res(200, { candidates: [{ content: { parts: [{ text: "{}" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })]);
    const r = await PV.callModel(opts(f, { provider: "gemini", model: "gemini-2.5-flash", apiKey: "AIza-test" }), input);
    assert.ok(!f.calls[0].url.includes("AIza"));
    assert.strictEqual(f.calls[0].init.headers["x-goog-api-key"], "AIza-test");
    assert.strictEqual(f.calls[0].body.generationConfig.responseMimeType, "application/json");
    assert.strictEqual(r.outputTokens, 5);
});
t("Provider: Gemini 'thinking' — chừa chỗ token suy nghĩ, tính tiền cả token suy nghĩ, MAX_TOKENS = lỗi thử lại", async () => {
    const f = fakeFetch([res(200, { candidates: [{ content: { parts: [{ text: "nghĩ…", thought: true }, { text: "{\"ok\":true}" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 40 } })]);
    const r = await PV.callModel(opts(f, { provider: "gemini", model: "gemini-3.5-flash", apiKey: "k" }), input);
    assert.strictEqual(r.text, "{\"ok\":true}");
    assert.strictEqual(r.outputTokens, 45);
    assert.ok(f.calls[0].body.generationConfig.maxOutputTokens > input.maxTokens);
    const cut = () => res(200, { candidates: [{ content: { parts: [{ text: "{\"ok\":" }] }, finishReason: "MAX_TOKENS" }] });
    const f2 = fakeFetch([cut(), cut(), cut()]);
    await assert.rejects(PV.callModel(opts(f2, { provider: "gemini", model: "x", apiKey: "k" }), input), (e) => e.code === "bad_response" && e.retryable);
});
t("Provider: OpenAI model đời mới dùng max_completion_tokens, không temperature", async () => {
    const f = fakeFetch([okChat()]);
    await PV.callModel(opts(f, { provider: "openai", model: "gpt-5-mini" }), input);
    assert.strictEqual(f.calls[0].body.max_completion_tokens, 100);
    assert.strictEqual(f.calls[0].body.temperature, undefined);
});
t("Provider: AI trả rỗng / không phải JSON HTTP → bad_response", async () => {
    const f = fakeFetch([res(200, "<html>"), res(200, "<html>"), res(200, "<html>")]);
    await assert.rejects(PV.callModel(opts(f), input), (e) => e.code === "bad_response");
});
t("Giới hạn lượt / phút", () => {
    let now = 0;
    const l = new PV.RateLimiter(2, () => now);
    assert.strictEqual(l.take(), 0);
    assert.strictEqual(l.take(), 0);
    assert.ok(l.take() > 0);
    now = 61_000;
    assert.strictEqual(l.take(), 0);
});

// ─── Pancake ───
const client = (fetch, auth = { pageToken: "PT", accountToken: null }) => PC.createPancakeClient({
    fetch, timeoutMs: 1000, auth: async () => auth, sleep: noSleep,
    senderContext: async () => ({ ownSenderNames: ["Public API"], ownMessageIds: new Set() }),
});
const convList = (o = {}) => res(200, { conversations: [{ id: "C1", type: "INBOX", tags: [{ id: 7, text: "AI CHAT" }], assignee_ids: [], updated_at: "2026-11-25T10:00:00", ...o }] });
t("Pancake: đọc hội thoại — public API v2 + v1, token page trên query, người gửi đúng loại", async () => {
    const f = fakeFetch([convList(), res(200, { messages: [
        { id: "a", original_message: "Dùng sao ạ", inserted_at: "2026-11-25T10:00:00", from: { id: "U" } },
        { id: "b", original_message: "Chào bạn", inserted_at: "2026-11-25T09:59:00", from: { id: "P1", is_automated: true } },
    ] })]);
    const snap = await client(f).fetchConversation("P1", "C1");
    assert.ok(f.calls[0].url.startsWith("https://pages.fm/api/public_api/v2/pages/P1/conversations?"));
    assert.ok(f.calls[0].url.includes("page_access_token=PT") && f.calls[0].url.includes("order_by=updated_at"));
    assert.ok(f.calls[1].url.startsWith("https://pages.fm/api/public_api/v1/pages/P1/conversations/C1/messages?"));
    assert.deepStrictEqual(snap.messages.map((m) => [m.id, m.kind]), [["b", "pos_auto"], ["a", "customer"]]);
    assert.deepStrictEqual(snap.conversation.tags, ["AI CHAT"]);
});
t("Pancake: gửi tin — body reply_inbox, lấy id; success:false = lỗi (không mơ hồ)", async () => {
    const f = fakeFetch([res(200, { success: true, id: "MID" })]);
    const r = await client(f).sendText("P1", "C1", "Xin chào");
    assert.deepStrictEqual(f.calls[0].body, { action: "reply_inbox", message: "Xin chào" });
    assert.strictEqual(f.calls[0].init.method, "POST");
    assert.deepStrictEqual(r, { ok: true, messageId: "MID" });
    const f2 = fakeFetch([res(200, { success: false, message: "(#2022) blocked" })]);
    const r2 = await client(f2).sendText("P1", "C1", "x");
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.ambiguous, false);
});
t("Pancake: gửi tin hết giờ → MƠ HỒ (không được gửi lại)", async () => {
    const f = fakeFetch([new Error("timeout")]);
    const r = await client(f).sendText("P1", "C1", "x");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.ambiguous, true);
    assert.strictEqual(f.calls.length, 1);
});
t("Pancake: gắn tag — tìm id theo tên, soát data sau cập nhật; tag chưa có → báo tạo tay", async () => {
    const f = fakeFetch([res(200, { tags: [{ id: 3, text: "Bot AI" }] }), res(200, { success: true, data: [3, 9] })]);
    const r = await client(f).addTag("P1", "C1", "bot ai");
    assert.deepStrictEqual(r, { ok: true });
    assert.deepStrictEqual(f.calls[1].body, { action: "add", tag_id: "3" });
    const f2 = fakeFetch([res(200, { tags: [] }), res(200, { tags: [] })]);
    const r2 = await client(f2).addTag("P1", "C1", "Bot AI");
    assert.ok(r2.ok && r2.skipped, "page chưa tạo tag = bỏ qua, không phải lỗi");
    const f3 = fakeFetch([res(200, { tags: [{ id: 3, text: "Bot AI" }] }), res(200, { success: true, data: [9] })]);
    assert.strictEqual((await client(f3).addTag("P1", "C1", "Bot AI")).ok, false);
});
t("Pancake: 429 khi đọc → chờ rồi thử lại; lỗi mã 121 báo rõ", async () => {
    const f = fakeFetch([res(429, {}), convList()]);
    const rows = await client(f).listRecentConversations("P1", 0, 1);
    assert.strictEqual(rows.length, 1);
    const f2 = fakeFetch([res(200, { success: false, error_code: 121, message: "not in plan" })]);
    await assert.rejects(client(f2).listRecentConversations("P1", 0, 1), (e) => e.code === "121");
});
t("Pancake: page chưa có token page → không gửi, không gọi mạng", async () => {
    const f = fakeFetch([]);
    const r = await client(f, { pageToken: null, accountToken: "AT" }).sendText("P1", "C1", "x");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(f.calls.length, 0);
});
t("Pancake: poller bỏ hội thoại page vừa trả lời, bỏ bình luận", () => {
    const rows = [
        { id: "A", type: "INBOX", last_sent_by: { id: "U" } },
        { id: "B", type: "INBOX", last_sent_by: { id: "P1", admin_name: "Lan" } },
        { id: "C", type: "COMMENT" },
        { id: "D" },
    ];
    assert.deepStrictEqual(PC.conversationsNeedingCheck(rows, "P1").map((x) => x.id), ["A", "D"]);
});
t("Pancake: đọc token page CÓ SẴN (không sinh mới)", async () => {
    const f = fakeFetch([res(200, { activated: [{ id: "P1", settings: { page_access_token: "tok-1234567890" } }, { id: "P2", settings: {} }] })]);
    const m = await PC.readExistingPageTokens(f, "AT");
    assert.ok(f.calls[0].url.startsWith("https://pages.fm/api/v1/pages?"));
    assert.ok(decodeURIComponent(f.calls[0].url).includes("settings{page_access_token}"));
    assert.deepStrictEqual([...m.entries()], [["P1", "tok-1234567890"]]);
});

// ─── Telegram ───
t("Telegram: gửi HTML; lỗi không lộ token", async () => {
    const f = fakeFetch([res(200, { ok: true })]);
    assert.deepStrictEqual(await TG.sendTelegram(f, "123:ABC", "-100", "<b>x</b>"), { ok: true });
    assert.strictEqual(f.calls[0].body.parse_mode, "HTML");
    const f2 = fakeFetch([new Error("fetch failed https://api.telegram.org/bot123:ABC/sendMessage")]);
    const r = await TG.sendTelegram(f2, "123:ABC", "-100", "x");
    assert.ok(!r.ok && !r.error.includes("123:ABC"));
    const f3 = fakeFetch([res(429, { ok: false, description: "Too Many Requests", parameters: { retry_after: 7 } })]);
    assert.strictEqual((await TG.sendTelegram(f3, "1:A", "-1", "x")).retryAfter, 7);
});

(async () => {
    console.log("── AI Chatbot: Provider AI · Pancake · Telegram (fetch giả) ──");
    let ok = 0;
    for (const [n, f] of tests) {
        try { await f(); ok++; console.log("  ✓", n); } catch (e) { console.error("  ✗", n); console.error(e); process.exit(1); }
    }
    console.log(`\n${ok} phép thử bộ chuyển đổi đạt.`);
})();
