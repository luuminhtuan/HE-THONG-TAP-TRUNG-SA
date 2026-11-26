// DATABASE_URL=postgresql://talpha:talpha@127.0.0.1:5433/talpha npm run test:ai-pg
// AI Chatbot — kho Postgres THẬT (migration 0009): hàng đợi (một job chờ / hội thoại, claim SKIP LOCKED), khoá thuê,
// idempotency lượt khách, outbox chống gửi trùng khi chạy song song, thông báo không trùng, AI Learning gom nhóm,
// Knowledge Base (tìm không dấu, lịch sử, xoá mềm, phạm vi nước), duyệt FAQ, số liệu theo nước.
// Dữ liệu thử dùng page "TESTAI_…" + nước "ZZ" — tự dọn khi xong. Không có DATABASE_URL → bỏ qua.
const assert = require("assert");
if (!process.env.DATABASE_URL) { console.log("── AI Chatbot · Postgres: BỎ QUA (chưa đặt DATABASE_URL)"); process.exit(0); }
const { Pool } = require("pg");
const { bindNamedParams } = require("../.test-build/lib/db.js");
const SP = require("../.test-build/ai-chatbot/store-pg.js");
const AD = require("../.test-build/ai-chatbot/admin-store.js");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: "-c TimeZone=UTC" });
const q = async (sql, params) => { const { text, values } = bindNamedParams(sql, params); return (await pool.query(text, values)).rows; };
const P = `TESTAI_${Date.now().toString(36)}`;
const P2 = `${P}_B`;
const scopeZZ = { full: false, codes: ["ZZ"], actor: "test" };
const scopeFull = { full: true, codes: [], actor: "test" };

const tests = [];
const t = (n, f) => tests.push([n, f]);
const { store, queue } = SP.createPgStore(q, { hasPageToken: () => true, hasAccountToken: () => true, kbCacheMs: 0,
    policy: () => ({ pagesAuto: true, live: false, otherBotQuietMs: 24 * 3600e3, errorBackoffMs: 30 * 60e3 }) });

t("một job CHỜ / hội thoại: enqueue lần 2 chỉ dời giờ", async () => {
    const a = await queue.enqueue(P, "C1", "poll", Date.now() + 60_000);
    const b = await queue.enqueue(P, "C1", "webhook", Date.now() - 1000);
    assert.strictEqual(a, b);
    const [r] = await q("SELECT count(*)::int AS n, min(run_after) AS ra FROM ai_bot_jobs WHERE page_id = @P AND status = 'pending'", { P });
    assert.strictEqual(r.n, 1);
    assert.ok(new Date(r.ra).getTime() <= Date.now());
});
t("claim: SKIP LOCKED, không nhận job của hội thoại đang chạy", async () => {
    const j = await queue.claim("W1", 60);
    assert.ok(j && j.pageId === P && j.conversationId === "C1" && j.attempts === 1);
    await queue.enqueue(P, "C1", "webhook", Date.now() - 1000);          // tin mới tới trong lúc đang chạy
    const j2 = await queue.claim("W2", 60);
    assert.ok(!j2 || j2.pageId !== P, "không được nhận job thứ hai của C1 khi C1 đang chạy");
    // trả job đang chạy về chờ: đã có job chờ khác → job này huỷ, job kia giữ
    await queue.requeue(j, Date.now() + 5000, "test", false);
    const rows = await q("SELECT status FROM ai_bot_jobs WHERE page_id = @P ORDER BY id", { P });
    assert.deepStrictEqual(rows.map((r) => r.status), ["cancelled", "pending"]);
});
t("claim song song 4 worker → mỗi job đúng một worker", async () => {
    for (let i = 0; i < 6; i++) await queue.enqueue(P2, `K${i}`, "poll", Date.now() - 1000);
    const got = (await Promise.all([1, 2, 3, 4].map(async (w) => { const out = []; for (;;) { const j = await queue.claim(`W${w}`, 60); if (!j) break; if (j.pageId === P2) out.push(j.id); } return out; }))).flat();
    assert.strictEqual(got.length, 6);
    assert.strictEqual(new Set(got).size, 6);
});
t("REVIEW: job chờ THỬ LẠI không bị tin mới kéo chạy sớm; job hỏng gần đây không tạo lại ngay", async () => {
    const id = await queue.enqueue(P2, "R1", "poll", Date.now() + 120_000);
    await q("UPDATE ai_bot_jobs SET attempts = 1 WHERE id = @id", { id });
    await queue.enqueue(P2, "R1", "webhook", Date.now() - 1000);
    const [r] = await q("SELECT run_after FROM ai_bot_jobs WHERE id = @id", { id });
    assert.ok(new Date(r.run_after).getTime() > Date.now() + 60_000);
    await q("INSERT INTO ai_bot_jobs (page_id, conversation_id, status, finished_at) VALUES (@P2, 'F1', 'failed', now())", { P2 });
    assert.strictEqual(await queue.enqueue(P2, "F1", "poll", Date.now()), null);
});
t("REVIEW: kết thúc / trả job chỉ khi còn giữ đúng mã khoá; gia hạn thuê", async () => {
    await queue.enqueue(P2, "T1", "poll", Date.now() - 1000);
    let j = null;
    for (let i = 0; i < 20 && !(j && j.conversationId === "T1"); i++) j = await queue.claim(`tok-${i}`, 60);
    assert.ok(j && j.conversationId === "T1");
    assert.strictEqual(await queue.renewLease(j, 120), true);
    await queue.finish({ ...j, lockedBy: "kẻ-khác" }, "done", "x", null, null);
    let [r] = await q("SELECT status FROM ai_bot_jobs WHERE id = @id", { id: j.id });
    assert.strictEqual(r.status, "running");
    await queue.finish(j, "done", "ok", null, null);
    [r] = await q("SELECT status FROM ai_bot_jobs WHERE id = @id", { id: j.id });
    assert.strictEqual(r.status, "done");
    assert.strictEqual(await queue.renewLease(j, 120), false);
});
t("TỰ ĐỘNG: page mới trong hộp thư tự chạy; lỗi page → tự nghỉ + báo 1 lần; bot khác → tự né; Tắt tay → tắt", async () => {
    const PA = `${P}_AUTO`;
    await q("INSERT INTO pancake_pages (page_id, name, market) VALUES (@PA, 'Page tự động', 'ZZ')", { PA });
    assert.strictEqual((await store.getPage(PA)).enabled, true);                      // không bật tay gì cả
    assert.ok((await queue.enabledPages()).some((p) => p.pageId === PA));
    assert.strictEqual(await queue.setPageHealth(PA, false, "122", "hết gói"), true);   // lần đầu lỗi → báo
    await queue.markAlerted(PA);
    assert.strictEqual(await queue.setPageHealth(PA, false, "122", "hết gói"), false);  // đã báo trong 24h → thôi
    assert.strictEqual((await store.getPage(PA)).enabled, false);
    await queue.setPageHealth(PA, true, null, null);
    assert.strictEqual((await store.getPage(PA)).enabled, true);                      // page sống lại → tự chạy
    await store.markOtherBot(PA);
    assert.strictEqual((await queue.allPages()).find((p) => p.pageId === PA).status, "other_bot");
    await q("UPDATE ai_bot_pages SET other_bot_at = NULL WHERE page_id = @PA", { PA });
    await AD.setPageMode(q, scopeFull, PA, "off");
    assert.strictEqual((await store.getPage(PA)).enabled, false);
    await q("DELETE FROM ai_bot_pages WHERE page_id = @PA", { PA });
    await q("DELETE FROM pancake_pages WHERE page_id = @PA", { PA });
});
t("job treo quá hạn thuê → về chờ", async () => {
    await q("UPDATE ai_bot_jobs SET locked_until = now() - interval '1 minute' WHERE page_id = @P2 AND conversation_id = 'K0'", { P2 });
    await queue.recoverStuck();
    const [r] = await q("SELECT status FROM ai_bot_jobs WHERE page_id = @P2 AND conversation_id = 'K0' ORDER BY id DESC LIMIT 1", { P2 });
    assert.strictEqual(r.status, "pending");
});
t("khoá thuê theo hội thoại: người khác không lấy được, chính mình lấy lại được, hết hạn thì nhường", async () => {
    assert.strictEqual(await queue.acquireLock(P, "C1", "W1", 60), true);
    assert.strictEqual(await queue.acquireLock(P, "C1", "W2", 60), false);
    assert.strictEqual(await queue.acquireLock(P, "C1", "W1", 60), true);
    await q("UPDATE ai_bot_locks SET locked_until = now() - interval '1 second' WHERE page_id = @P", { P });
    assert.strictEqual(await queue.acquireLock(P, "C1", "W2", 60), true);
    await queue.releaseLock(P, "C1", "W2");
    assert.strictEqual(await queue.acquireLock(P, "C1", "W3", 60), true);
    await queue.releaseLock(P, "C1", "W3");
});
const run = (over = {}) => ({ jobId: null, pageId: P, conversationId: "C1", turnMessageId: "m1", market: "ZZ", customerText: "Kem dùng sao",
    language: "vi", intent: "product_usage", classification: { a: 1 }, retrieved: [{ id: 1, title: "x", score: 0.9, stale: false }], answer: "Dạ",
    decision: "answered", reason: "answered", provider: "deepseek", model: "deepseek-chat", inputTokens: 100, outputTokens: 20, costUsd: 0.0012,
    confidence: 0.9, durationMs: 1234, sentMessageId: "OUT", tagStatus: "ok", mode: "live", trace: [{ step: "x", ok: true }], ...over });
t("idempotency: mỗi lượt khách MỘT quyết định", async () => {
    const id = await store.insertRun(run());
    assert.ok(id > 0);
    assert.strictEqual(await store.insertRun(run({ decision: "escalated" })), null);
    assert.deepStrictEqual(await store.getRunForTurn(P, "C1", "m1"), { id, decision: "answered" });
    assert.strictEqual(await store.countAiRepliesSince(P, "C1", Date.now() - 60_000), 1);
});
t("outbox: 5 lượt giữ chỗ song song → đúng 1 được gửi; tin đã gửi nhận ra là của AI", async () => {
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => store.reserveOutbox(P, "C1", "m1", "Dạ")));
    assert.strictEqual(res.filter(Boolean).length, 1);
    await store.finishOutbox(P, "C1", "m1", "sent", "PMSG1", null);
    assert.deepStrictEqual([...await store.ownSentMessageIds(P, "C1")], ["PMSG1"]);
    assert.ok((await store.lastPageSendAt(P)) > Date.now() - 60_000);
});
t("thông báo Telegram không trùng", async () => {
    assert.strictEqual(await store.reserveNotification(`esc:${P}:C1:m1`, { a: 1 }), true);
    assert.strictEqual(await store.reserveNotification(`esc:${P}:C1:m1`, { a: 1 }), false);
    await store.finishNotification(`esc:${P}:C1:m1`, false, "Telegram 502");
    const [r] = await q("SELECT status, attempts, error FROM ai_bot_notifications WHERE dedup_key = @k", { k: `esc:${P}:C1:m1` });
    assert.deepStrictEqual([r.status, r.attempts, r.error], ["failed", 1, "Telegram 502"]);
});
t("trạng thái hội thoại: lưu không đè tạm dừng; tạm dừng chỉ kéo dài", async () => {
    await store.pauseConversation(P, "C1", Date.now() + 3600_000, "manual");
    await store.pauseConversation(P, "C1", Date.now() + 60_000, "escalated");            // ngắn hơn → không rút ngắn
    await store.saveConversationState({ pageId: P, conversationId: "C1", pausedUntil: null, pausedReason: null,
        language: "vi", lastProducts: [3, 4], lastIntent: "product_usage", lastAiReplyAt: Date.now() });
    const s = await store.getConversationState(P, "C1");
    assert.deepStrictEqual([s.pausedReason, s.lastProducts, s.language], ["manual", [3, 4], "vi"]);
    assert.ok(s.pausedUntil > Date.now() + 3000_000);
    await AD.pauseConversation(q, scopeFull, P, "C1", 0);
    assert.strictEqual((await store.getConversationState(P, "C1")).pausedUntil, null);
});
t("AI Learning: câu tương tự gom một nhóm, cùng tin không đếm hai lần", async () => {
    const u = (text, messageId) => store.recordUnanswered({ pageId: P, market: "ZZ", conversationId: "C1", messageId, text, intent: "product_info", language: "vi", reason: "no_knowledge", runId: null });
    await u("Kem này bà bầu dùng được không?", "a1");
    await u("kem nay ba bau dung duoc khong shop", "a2");
    await u("kem nay ba bau dung duoc khong shop", "a2");
    await u("Shop có giao sang Nhật không?", "a3");
    const rows = await q("SELECT sample_text, occurrences FROM ai_learning_questions WHERE market = 'ZZ' ORDER BY id");
    assert.deepStrictEqual(rows.map((r) => r.occurrences), [2, 1]);
});
t("Knowledge Base: tạo, tìm không dấu, sửa có lịch sử, tắt, xoá mềm, phạm vi nước", async () => {
    const v = AD.parseKbInput({ scope: "market", market: "ZZ", kind: "policy", title: "Chính sách đổi trả ZZ", content: "Đổi trả trong 7 ngày nếu lỗi.", keywords: "doi tra, hoan tien" });
    assert.ok(v.ok);
    const id = await AD.createKb(q, scopeZZ, v.value);
    const found = await AD.listKb(q, scopeZZ, { q: "doi tra" });
    assert.ok(found.rows.some((r) => Number(r.id) === id));
    assert.strictEqual((await AD.listKb(q, { full: false, codes: ["YY"], actor: "x" }, { q: "doi tra zz" })).rows.length, 0);
    const v2 = AD.parseKbInput({ scope: "market", market: "ZZ", kind: "policy", title: "Chính sách đổi trả ZZ", content: "Đổi trả trong 10 ngày nếu lỗi." });
    assert.strictEqual(await AD.updateKb(q, scopeZZ, id, v2.value), "ok");
    const detail = await AD.getKb(q, scopeZZ, id);
    assert.deepStrictEqual(detail.revisions.map((r) => r.action), ["update", "create"]);
    const cand = await store.knowledgeCandidates({ pageId: P, market: "ZZ" });
    assert.ok(cand.some((e) => e.id === id && e.content.includes("10 ngày")));
    assert.ok(!(await store.knowledgeCandidates({ pageId: P, market: "YY" })).some((e) => e.id === id));
    await AD.setKbEnabled(q, scopeZZ, id, false);
    assert.ok(!(await store.knowledgeCandidates({ pageId: P, market: "ZZ" })).some((e) => e.id === id));
    assert.strictEqual(await AD.deleteKb(q, scopeZZ, id), "ok");
    assert.strictEqual(await AD.getKb(q, scopeZZ, id), null);
    assert.strictEqual(AD.parseKbInput({ scope: "global", kind: "product", title: "abc", content: "abc" }).ok, false);
});
t("duyệt câu hỏi → FAQ trong KB, nhóm chuyển 'approved'", async () => {
    const [qq] = await q("SELECT id FROM ai_learning_questions WHERE market = 'ZZ' ORDER BY id LIMIT 1");
    assert.strictEqual(await AD.setLearningStatus(q, scopeZZ, qq.id, "processing"), "ok");
    const r = await AD.approveLearning(q, scopeZZ, qq.id, "Dạ phụ nữ mang thai nên hỏi ý kiến bác sĩ trước khi dùng ạ.");
    assert.ok(r.ok);
    const kb = await AD.getKb(q, scopeZZ, r.kbId);
    assert.strictEqual(kb.entry.source, "learning");
    assert.ok(kb.entry.content.includes("bác sĩ"));
    const l = await AD.getLearning(q, scopeZZ, qq.id);
    assert.strictEqual(l.question.status, "approved");
    assert.ok(l.history.some((h) => h.action === "approve"));
    assert.strictEqual((await AD.approveLearning(q, scopeZZ, qq.id, "lần hai")).ok, false);
});
t("số liệu Dashboard + nhật ký lọc theo nước", async () => {
    await store.insertRun(run({ turnMessageId: "m2", decision: "escalated", reason: "no_knowledge", answer: null }));
    const today = new Date().toISOString().slice(0, 10);
    const s = await AD.stats(q, scopeZZ, today, today);
    assert.strictEqual(s.totals.received, 2);
    assert.strictEqual(s.totals.answered, 1);
    assert.strictEqual(s.totals.auto_rate, 0.5);
    assert.strictEqual(s.provider_cost, null);                    // chi phí chung chỉ người xem hết
    const logs = await AD.listRuns(q, scopeZZ, { decision: "escalated" });
    assert.strictEqual(logs.total, 1);
    assert.strictEqual((await AD.listRuns(q, { full: false, codes: ["YY"], actor: "x" }, {})).total, 0);
    const one = await AD.getRun(q, scopeZZ, logs.rows[0].id);
    assert.strictEqual(one.reason, "no_knowledge");
});
t("luật POS: soát regex, lưu, đọc theo page", async () => {
    assert.strictEqual(AD.parsePosRule({ kind: "regex", pattern: "(" }).ok, false);
    const v = AD.parsePosRule({ kind: "keyword", pattern: "bảng giá", page_id: P });
    const id = await AD.savePosRule(q, scopeFull, null, v.value);
    const rules = await store.listPosRules(P);
    assert.ok(rules.some((r) => r.id === id && r.kind === "keyword"));
    assert.ok(!(await store.listPosRules(P2)).some((r) => r.id === id));
    await q("DELETE FROM ai_bot_pos_rules WHERE id = @id", { id });
});
t("chi phí: ghi lượt gọi model → trần chi phí đọc được", async () => {
    const before = await store.costSince(Date.now() - 60_000);
    await queue.recordProviderCall({ purpose: "test", provider: "deepseek", model: "x", inputTokens: 10, outputTokens: 5, costUsd: 0.5, latencyMs: 10, ok: true, pageId: P });
    assert.ok(Math.abs((await store.costSince(Date.now() - 60_000)) - before - 0.5) < 1e-6);
});

t("Router + Postgres trọn luồng (Pancake / AI giả): trả lời → gửi 1 lần → lượt lặp lại không làm gì; chuyển Sale → Learning + thông báo", async () => {
    const R = require("../.test-build/ai-chatbot/router.js");
    const S = require("../.test-build/ai-chatbot/settings.js");
    const PE = `${P}_E2E`;
    await q("INSERT INTO pancake_pages (page_id, name, market) VALUES (@PE, 'Page thử E2E', 'ZZ')", { PE });
    const kb = AD.parseKbInput({ scope: "page", page_id: PE, kind: "document", title: "Kem Hydra E2E", content: "Kem Hydra E2E: thoa 2 lần mỗi ngày sau khi rửa mặt." });
    const kbId = await AD.createKb(q, scopeFull, kb.value);
    const settings = S.normalizeSettings({ enabled: true, mode: "live", debounce_seconds: 0, pos_grace_seconds: 0, telegram: { enabled: true, chat_id: "-1001" },
        pricing: { "*": { input_per_m: 1, output_per_m: 1 } } }).settings;
    const now = Date.now();
    const msgs = [{ id: "e0", kind: "customer", at: now - 600_000, text: "Shop ơi" }, { id: "e0b", kind: "pos_auto", at: now - 590_000, text: "Chào bạn!" },
        { id: "e1", kind: "customer", at: now - 120_000, text: "Kem Hydra E2E dùng thế nào?" }];
    const sent = [];
    const chat = {
        async fetchConversation() { return { conversation: { id: "CE", pageId: PE, tags: [], assigneeIds: [] }, messages: msgs.map((m) => ({ ...m })), complete: true }; },
        async sendText(p, c, text) { sent.push(text); msgs.push({ id: `OUT${sent.length}`, kind: "human", at: Date.now(), text }); return { ok: true, messageId: `OUT${sent.length}` }; },
        async addTag() { return { ok: true }; },
    };
    let gen = { answer: "Dạ bạn thoa 2 lần mỗi ngày sau khi rửa mặt ạ.", language: "vi", used_source_ids: [kbId], confidence: 0.95, unanswered: [] };
    const ai = { async chat(req) {
        const body = req.purpose === "classify"
            ? (msgs[msgs.length - 1].text.includes("Nhật")
                ? { language: "vi", primary_intent: "shipping", questions: [{ text: "Có ship sang Nhật không?", intent: "shipping" }], search_queries: ["ship sang nhat"], confidence: 0.95 }
                : { language: "vi", primary_intent: "product_usage", questions: [{ text: msgs[msgs.length - 1].text, intent: "product_usage" }], search_queries: ["kem hydra e2e"], confidence: 0.95 })
            : gen;
        return { text: JSON.stringify(body), provider: "fake", model: "fake", inputTokens: 10, outputTokens: 5, costUsd: 0, latencyMs: 1 };
    } };
    const notes = [];
    const deps = { store, chat, ai, notifier: { async notify(p) { notes.push(p); return { ok: true }; } }, now: () => Date.now(), settings: () => settings,
        links: () => ({ dashboardUrl: null, pancakeUrl: null }) };
    const job = { jobId: null, pageId: PE, conversationId: "CE", attempt: 1, source: "test" };
    const r1 = await R.processTurn(job, deps);
    assert.strictEqual(r1.decision, "answered");
    assert.strictEqual(sent.length, 1);
    const r2 = await R.processTurn(job, deps);
    assert.strictEqual(r2.kind, "noop");
    assert.strictEqual(sent.length, 1);
    const [row] = await q("SELECT decision, trace, retrieved, sent_message_id FROM ai_bot_runs WHERE page_id = @PE", { PE });
    assert.strictEqual(row.sent_message_id, "OUT1");
    assert.ok(Array.isArray(row.trace) && row.trace.some((s) => s.step === "send" && s.ok));
    assert.ok(row.retrieved.some((x) => Number(x.id) === kbId));
    // Lượt mới không có dữ liệu → chuyển Sale.
    msgs.push({ id: "e2", kind: "customer", at: Date.now() - 1000, text: "Có ship sang Nhật không?" });
    const r3 = await R.processTurn(job, deps);
    assert.strictEqual(r3.reason, "no_knowledge");
    assert.strictEqual(notes.length, 1);
    // Câu hỏi gom vào nhóm câu tương tự CÙNG NƯỚC (có thể là nhóm sẵn có) — đếm lần hỏi của page này.
    const occ = await q("SELECT count(*)::int AS n FROM ai_learning_occurrences WHERE page_id = @PE", { PE });
    assert.strictEqual(occ[0].n, 1);
    await q("DELETE FROM ai_bot_pages WHERE page_id = @PE", { PE });
    await q("DELETE FROM pancake_pages WHERE page_id = @PE", { PE });
    await q("DELETE FROM ai_learning_questions WHERE page_id = @PE", { PE });
    await q("DELETE FROM ai_kb_revisions WHERE entry_id = @kbId", { kbId });
    await q("DELETE FROM ai_kb_entries WHERE id = @kbId", { kbId });
});

(async () => {
    console.log("── AI Chatbot · Postgres thật ──");
    let ok = 0, failed = false;
    for (const [n, f] of tests) {
        try { await f(); ok++; console.log("  ✓", n); } catch (e) { console.error("  ✗", n); console.error(e); failed = true; break; }
    }
    // Dọn dữ liệu thử (chỉ các dòng mang mã thử "TESTAI_" — cả của lần chạy trước hỏng giữa chừng).
    const like = "TESTAI\\_%";
    await q("DELETE FROM ai_bot_jobs WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_bot_locks WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_bot_runs WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_bot_outbox WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_bot_notifications WHERE dedup_key LIKE @k", { k: "esc:TESTAI\\_%" });
    await q("DELETE FROM ai_bot_pages WHERE page_id LIKE @like", { like });
    await q("DELETE FROM pancake_pages WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_learning_questions WHERE page_id LIKE @like", { like });
    const pageKb = (await q("SELECT id FROM ai_kb_entries WHERE page_id LIKE @like", { like })).map((r) => r.id);
    if (pageKb.length) { await q("DELETE FROM ai_kb_revisions WHERE entry_id = ANY(@ids)", { ids: pageKb }); await q("DELETE FROM ai_kb_entries WHERE id = ANY(@ids)", { ids: pageKb }); }
    await q("DELETE FROM ai_bot_conversation_state WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_bot_provider_calls WHERE page_id LIKE @like", { like });
    await q("DELETE FROM ai_learning_questions WHERE market = 'ZZ'");
    const ids = (await q("SELECT id FROM ai_kb_entries WHERE market = 'ZZ'")).map((r) => r.id);
    if (ids.length) { await q("DELETE FROM ai_kb_revisions WHERE entry_id = ANY(@ids)", { ids }); await q("DELETE FROM ai_kb_entries WHERE id = ANY(@ids)", { ids }); }
    await pool.end();
    if (failed) process.exit(1);
    console.log(`\n${ok} phép thử Postgres đạt (dữ liệu thử đã dọn).`);
})();
