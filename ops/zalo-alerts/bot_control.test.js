// node bot_control.test.js   (không gọi mạng, không cần cài zca-js)
// Điều khiển bot từ trang /admin → Khoá kết nối → Zalo (16/11/2026): bot nhặt yêu cầu, làm, ghi kết quả + trạng thái.
// Phiên Zalo, zca-js và dashboard đều là bản giả — kiểm luồng, không đăng nhập thật.
const assert = require("assert");
const { createControl, testMessage, CONTROL_PATH } = require("./bot_control");

let ok = 0;
const t = async (name, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${name}`); throw e; }
};

function harness({ requests = [], groups = [{ id: "111", name: "ADS + VẬN ĐƠN TAIWAN" }, { id: "222", name: "TEST BOT" }], paired = true } = {}) {
    const queue = [...requests];
    const posts = [], sent = [], saved = [], removed = [], introduced = [];
    const state = { marketGroups: {}, loggedIn: paired, account: paired ? "Nick phụ" : null, reset: 0, logout: 0, woke: 0, pageManaged: false };
    const session = {
        isLoggedIn: () => state.loggedIn,
        getMarketGroups: () => state.marketGroups,
        connect: async () => { if (!state.account) throw new Error("chưa ghép nick Zalo"); state.loggedIn = true; return {}; },
        loadGroups: () => {
            state.marketGroups = Object.fromEntries(saved.filter((x) => !removed.includes(x.market)).map((x) => [x.market, x.group]));
        },
        markPageManaged: () => { state.pageManaged = true; },
        markIntroduced: (id) => { introduced.push(id); },
        pruneGroups: (list) => {
            const ids = new Set(list.map((g) => g.id));
            const dropped = Object.keys(state.marketGroups).filter((m) => !ids.has(state.marketGroups[m].id));
            for (const m of dropped) delete state.marketGroups[m];
            return dropped;
        },
        enqueue: (fn) => fn(),
        sendOne: async (text, group) => { sent.push({ text, group }); return 1; },
        resetSession: () => { state.reset++; },
        logout: () => { state.logout++; state.loggedIn = false; state.account = null; },
        wakeUp: () => { state.woke++; },
    };
    const zalo = {
        sessionAccountName: () => state.account,
        listGroups: async () => groups,
        saveMarketGroup: (market, group, method) => { saved.push({ market, group, method }); },
        removeMarketGroup: (market) => { removed.push(market); },
        pairByQr: async ({ onEvent }) => {
            await onEvent({ stage: "qr", qrPng: "QRBASE64", attempt: 1, maxAttempts: 5 });
            await onEvent({ stage: "scanned", name: "Nick mới" });
            state.account = "Nick mới";
            return { api: {}, name: "Nick mới" };
        },
    };
    const http = {
        get: async (path) => { assert.strictEqual(path, `${CONTROL_PATH}?claim=1`); return { request: queue.shift() || null }; },
        post: async (path, body) => { assert.strictEqual(path, CONTROL_PATH); posts.push(body); return { ok: true }; },
    };
    const control = createControl({
        session, zalo, http, log: () => {}, markets: ["TW", "SG"], marketInfo: { TW: { ten: "Đài Loan", flag: "🇹🇼" } },
        now: () => new Date("2026-11-16T09:30:00Z"),
    });
    const finishes = () => posts.filter((p) => p.finish).map((p) => p.finish);
    const statuses = () => posts.filter((p) => p.status).map((p) => p.status);
    return { control, state, posts, sent, saved, removed, introduced, finishes, statuses };
}

(async () => {
    await t("không có yêu cầu: không làm gì", async () => {
        const h = harness();
        assert.strictEqual(await h.control.pollOnce(), null);
        assert.strictEqual(h.posts.length, 0);
    });

    await t("ghép nick: đẩy ảnh QR, báo đã quét, xong thì báo nick + nhóm, đánh thức bot", async () => {
        const h = harness({ paired: false, requests: [{ id: 1, action: "pair", payload: {} }] });
        const r = await h.control.pollOnce();
        assert.ok(r.ok, r.result);
        const stages = h.statuses().filter((s) => s.pairing).map((s) => s.pairing.stage);
        assert.deepStrictEqual(stages, ["qr", "qr", "scanned", "done"]);
        assert.strictEqual(h.statuses().find((s) => s.pairing && s.pairing.qr_png).pairing.qr_png, "QRBASE64");
        const done = h.statuses().find((s) => s.pairing && s.pairing.stage === "done");
        assert.strictEqual(done.account_name, "Nick mới");
        assert.strictEqual(done.pairing.qr_png, null, "xong thì không giữ mã QR");
        assert.strictEqual(done.groups.length, 2);
        assert.ok(h.state.reset === 1 && h.state.woke === 1);
        assert.ok(h.state.pageManaged, "ghép trên trang → nhóm do trang quản lý (bot thôi tự nhận, thôi tự nhắn)");
        assert.strictEqual(h.sent.length, 0, "ghép xong KHÔNG được nhắn gì vào nhóm nào");
        assert.deepStrictEqual(h.finishes(), [{ id: 1, ok: true, result: 'Đã ghép nick "Nick mới" · 2 nhóm' }]);
    });

    await t("đổi nick: bỏ nhóm đã chọn cho nick cũ mà nick mới không ở trong", async () => {
        const h = harness({ paired: false, requests: [{ id: 11, action: "pair", payload: {} }] });
        h.state.marketGroups = { TW: { id: "394918045257421366", name: "ADS + VẬN ĐƠN TAIWAN (nick cũ)" }, SG: { id: "222", name: "TEST BOT" } };
        const r = await h.control.pollOnce();
        assert.ok(r.ok, r.result);
        assert.deepStrictEqual(Object.keys(h.state.marketGroups), ["SG"]);
        assert.ok(/bỏ nhóm cũ của TW/.test(r.result));
    });

    await t("chọn nhóm: ghi file nhóm của nước, nạp lại, báo nhóm mới", async () => {
        const h = harness({ requests: [{ id: 2, action: "set_group", payload: { market: "TW", group_id: "222" } }] });
        const r = await h.control.pollOnce();
        assert.ok(r.ok, r.result);
        assert.deepStrictEqual(h.saved, [{ market: "TW", group: { id: "222", name: "TEST BOT" }, method: "trang" }]);
        assert.deepStrictEqual(h.statuses().pop().market_groups, { TW: { id: "222", name: "TEST BOT" } });
        assert.deepStrictEqual(h.introduced, ["222"], "đánh dấu đã giới thiệu — không tự nhắn");
        assert.strictEqual(h.sent.length, 0);
    });

    await t("bỏ chọn nhóm (trống): xoá nhóm của nước, không gửi gì", async () => {
        const h = harness({ requests: [{ id: 12, action: "set_group", payload: { market: "TW", group_id: "" } }] });
        const r = await h.control.pollOnce();
        assert.ok(r.ok, r.result);
        assert.deepStrictEqual(h.removed, ["TW"]);
        assert.strictEqual(h.saved.length, 0);
    });

    await t("chọn nhóm nick không ở trong: lỗi rõ, không ghi file", async () => {
        const h = harness({ requests: [{ id: 3, action: "set_group", payload: { market: "TW", group_id: "999" } }] });
        const r = await h.control.pollOnce();
        assert.strictEqual(r.ok, false);
        assert.ok(/không ở nhóm này/.test(r.result));
        assert.strictEqual(h.saved.length, 0);
        assert.ok(h.statuses().some((s) => /set_group/.test(s.last_error || "")));
    });

    await t("gửi thử: đúng nhóm của nước, tin có tên nước", async () => {
        const h = harness({ requests: [{ id: 4, action: "send_test", payload: { market: "TW" } }] });
        h.state.marketGroups = { TW: { id: "222", name: "TEST BOT" } };
        const r = await h.control.pollOnce();
        assert.ok(r.ok, r.result);
        assert.strictEqual(h.sent.length, 1);
        assert.strictEqual(h.sent[0].group.id, "222");
        assert.ok(h.sent[0].text.includes("🇹🇼 Đài Loan"));
    });

    await t("gửi thử vào nhóm nick không ở trong: lỗi dễ hiểu, không gọi Zalo", async () => {
        const h = harness({ requests: [{ id: 13, action: "send_test", payload: { market: "TW" } }] });
        h.state.marketGroups = { TW: { id: "394918045257421366", name: "ADS + VẬN ĐƠN TAIWAN" } };
        const r = await h.control.pollOnce();
        assert.strictEqual(r.ok, false);
        assert.ok(/không ở nhóm/.test(r.result), r.result);
        assert.strictEqual(h.sent.length, 0);
    });

    await t("gửi thử nước chưa có nhóm: lỗi, không gửi gì", async () => {
        const h = harness({ requests: [{ id: 5, action: "send_test", payload: { market: "SG" } }] });
        const r = await h.control.pollOnce();
        assert.strictEqual(r.ok, false);
        assert.strictEqual(h.sent.length, 0);
    });

    await t("bỏ ghép: xoá phiên, báo chưa đăng nhập", async () => {
        const h = harness({ requests: [{ id: 6, action: "unpair", payload: {} }] });
        const r = await h.control.pollOnce();
        assert.ok(r.ok);
        assert.strictEqual(h.state.logout, 1);
        const last = h.statuses().pop();
        assert.strictEqual(last.logged_in, false);
        assert.strictEqual(last.account_name, null);
    });

    await t("ghép hỏng (hết mã QR): báo pairing failed + kết quả lỗi", async () => {
        const posts = [];
        const control = createControl({
            session: { isLoggedIn: () => false, getMarketGroups: () => ({}), resetSession() {}, wakeUp() {} },
            zalo: { sessionAccountName: () => null, pairByQr: async () => { throw new Error("mã QR hết hạn 5 lần — chưa ai quét"); } },
            http: { get: async () => ({ request: { id: 7, action: "pair", payload: {} } }), post: async (path, body) => { posts.push(body); } },
            log: () => {}, markets: ["TW"],
        });
        const r = await control.pollOnce();
        assert.strictEqual(r.ok, false);
        const failed = posts.filter((p) => p.status && p.status.pairing).pop().status.pairing;
        assert.strictEqual(failed.stage, "failed");
        assert.ok(/hết hạn/.test(failed.message));
        assert.strictEqual(posts.filter((p) => p.finish).pop().finish.ok, false);
    });

    await t("việc lạ: lỗi, vẫn đóng yêu cầu", async () => {
        const h = harness({ requests: [{ id: 8, action: "xoa_het", payload: {} }] });
        const r = await h.control.pollOnce();
        assert.strictEqual(r.ok, false);
        assert.strictEqual(h.finishes()[0].id, 8);
    });

    await t("mất đăng nhập (cookie chết, file phiên còn): báo logged_in false + lỗi; vào lại thì xoá đúng lỗi đó", async () => {
        const posts = [];
        let problem = { error: "Đăng nhập thất bại", since: "2026-11-16T02:00:00Z", needsQr: true };
        const control = createControl({
            session: { isLoggedIn: () => false, getMarketGroups: () => ({}), getLoginProblem: () => problem },
            zalo: { sessionAccountName: () => "Hoàng Rin" },
            http: { get: async () => ({ request: null }), post: async (path, body) => { posts.push(body.status); } },
            log: () => {}, markets: ["TW"],
        });
        await control.pushStatus();
        assert.strictEqual(posts[0].logged_in, false);
        assert.strictEqual(posts[0].account_name, "Hoàng Rin");
        assert.ok(/Mất đăng nhập Zalo từ 09:00 16\/11: Đăng nhập thất bại — cần ghép lại nick/.test(posts[0].last_error), posts[0].last_error);
        problem = null;
        await control.pushStatus();
        assert.strictEqual(posts[1].logged_in, true);
        assert.strictEqual(posts[1].last_error, null, "đăng nhập lại được → xoá dòng lỗi đã ghi");
        await control.pushStatus();
        assert.ok(!("last_error" in posts[2]), "nhịp sau không đụng last_error (lỗi việc khác giữ nguyên)");
    });

    await t("tin thử không có ký tự markdown thô", () => {
        const text = testMessage("SG", { ten: "Singapore", flag: "🇸🇬" }, new Date("2026-11-16T09:30:00Z"));
        assert.ok(!text.includes("**"));
        assert.ok(text.includes("🇸🇬 Singapore") && text.includes("16:30"));
    });

    console.log(`bot_control.test.js: ${ok}/${ok} PASS`);
})().catch((e) => { console.error(e); process.exit(1); });
