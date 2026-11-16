// node bot_store.test.js   (không gọi mạng, không cần zca-js)
// Kho của bot trong database (16/11/2026): state / nhóm / phiên nằm trong bộ nhớ, ghi dần lên dashboard; lần đầu
// chép file cũ vào kho rồi xoá file. Dashboard ở đây là bản giả trong bộ nhớ làm đúng luật của kho thật
// (dashboard-ui/src/lib/talpha/zalo-bot-store.ts: import chỉ ghi chỗ còn trống).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore, rowsToState, stateToRows, diffState, canon, STORE_PATH } = require("./bot_store");

let ok = 0;
const t = async (name, fn) => {
    try { await fn(); ok++; }
    catch (e) { console.error(`✗ ${name}`); throw e; }
};

/** Dashboard giả: giữ dòng kho, áp store_ops / import như route thật. failPosts = số lượt POST đầu tiên trả lỗi. */
function fakeDashboard({ failPosts = 0, initial = {} } = {}) {
    const db = { state: new Map(), groups: { ...(initial.groups || {}) }, session: initial.session || null };
    for (const r of initial.state_rows || []) db.state.set(`${r.section}\u0000${r.item}`, r);
    const posts = [];
    let failures = failPosts;
    const http = {
        get: async (p) => {
            assert.strictEqual(p, `${STORE_PATH}?store=1`);
            const state_rows = [...db.state.values()].map((r) => JSON.parse(JSON.stringify(r)));
            return { state_rows, market_groups: JSON.parse(JSON.stringify(db.groups)), session: db.session ? { ...db.session } : null };
        },
        post: async (p, body) => {
            assert.strictEqual(p, STORE_PATH);
            if (failures > 0) { failures--; throw new Error("fetch failed"); }
            posts.push(JSON.parse(JSON.stringify(body)));
            for (const op of body.store_ops || []) {
                const k = `${op.section}\u0000${op.item}`;
                if (op.type === "state_set") db.state.set(k, { section: op.section, item: op.item, value: op.value });
                if (op.type === "state_del") for (const key of [...db.state.keys()]) {
                    const [s, i] = key.split("\u0000");
                    if (s === op.section && (op.item === null || i === op.item)) db.state.delete(key);
                }
                if (op.type === "group_set") db.groups[op.market] = { id: op.id, name: op.name, method: op.method, chosen_at: op.chosen_at };
                if (op.type === "group_del") delete db.groups[op.market];
                if (op.type === "session_set") db.session = op.value;
                if (op.type === "session_del") db.session = null;
            }
            if (body.import) {
                const im = body.import;
                if (im.session && !db.session) db.session = im.session;
                for (const [m, g] of Object.entries(im.market_groups || {})) if (!db.groups[m]) db.groups[m] = g;
                for (const r of im.state_rows || []) { const k = `${r.section}\u0000${r.item}`; if (!db.state.has(k)) db.state.set(k, r); }
            }
            return { ok: true };
        },
    };
    return { db, http, posts };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "bot-store-"));
const opsOf = (posts) => posts.flatMap((b) => b.store_ops || []);

(async () => {
    await t("state ↔ dòng kho: hai tầng, giá trị đứng riêng, object rỗng bỏ", () => {
        const st = { moc: { "ads:TW:18:00": "2026-11-16" }, nhomTuTrang: "2026-11-16T09:57:59Z", soMoc: { "TW|13:00": { ngay: "2026-11-15", so: [1, 2] } }, rong: {} };
        const rows = stateToRows(st);
        assert.ok(rows.some((r) => r.section === "nhomTuTrang" && r.item === ""));
        const { rong, ...rest } = st;
        assert.deepStrictEqual(rowsToState(rows), rest);
        assert.deepStrictEqual(rong, {});
    });

    await t("diffState: chỉ mục đổi; xoá mục, xoá cả section, đổi kiểu", () => {
        assert.deepStrictEqual(diffState({ moc: { a: 1 } }, { moc: { a: 1 } }), []);
        assert.deepStrictEqual(diffState({ moc: { a: 1, b: 2 } }, { moc: { a: 1, b: 3, c: 4 } }),
            [{ type: "state_set", section: "moc", item: "b", value: 3 }, { type: "state_set", section: "moc", item: "c", value: 4 }]);
        assert.deepStrictEqual(diffState({ dinhChinh: { k: {} } }, { dinhChinh: {} }), [{ type: "state_del", section: "dinhChinh", item: "k" }]);
        assert.deepStrictEqual(diffState({ x: { a: 1 } }, {}), [{ type: "state_del", section: "x", item: null }]);
        assert.deepStrictEqual(diffState({ x: "v" }, { x: { a: 1 } }),
            [{ type: "state_del", section: "x", item: "" }, { type: "state_set", section: "x", item: "a", value: 1 }]);
        assert.deepStrictEqual(diffState({ x: { a: 1 } }, { x: 5 }),
            [{ type: "state_del", section: "x", item: null }, { type: "state_set", section: "x", item: "", value: 5 }]);
        assert.deepStrictEqual(diffState({ s: { o: { b: 1, a: 2 } } }, { s: { o: { a: 2, b: 1 } } }), [], "khác thứ tự khoá ≠ đổi");
    });

    await t("markState: sửa bộ nhớ ngay, ghi đúng mục đổi lên dashboard; bản đọc ra là bản sao", async () => {
        const D = fakeDashboard({ initial: { state_rows: [{ section: "moc", item: "ads:TW:13:00", value: "2026-11-16" }] } });
        const s = createStore({ http: D.http, dir: tmpDir() });
        await s.prime();
        s.markState((st) => { st.moc["ads:TW:18:00"] = "2026-11-16"; });
        assert.strictEqual(s.loadState().moc["ads:TW:18:00"], "2026-11-16");
        const copy = s.loadState(); copy.moc.x = 1;
        assert.strictEqual(s.loadState().moc.x, undefined, "sửa bản đọc ra không đổi kho");
        assert.ok(await s.flush());
        assert.deepStrictEqual(opsOf(D.posts), [{ type: "state_set", section: "moc", item: "ads:TW:18:00", value: "2026-11-16" }]);
        assert.ok(D.db.state.has("moc\u0000ads:TW:18:00"));
    });

    await t("dashboard hỏng: giữ hàng, thử lại tới khi ghi được; flush hết hạn → false", async () => {
        const D = fakeDashboard({ failPosts: 2 });
        const s = createStore({ http: D.http, dir: tmpDir(), retryMs: 5 });
        await s.prime();
        s.saveGroup("tw", { id: "5092035087637680474", name: "ADS + VẬN ĐƠN TAIWAN" }, "trang");
        assert.ok(await s.flush(2000));
        assert.strictEqual(D.db.groups.TW.id, "5092035087637680474");
        const D2 = fakeDashboard({ failPosts: 1000 });
        const s2 = createStore({ http: D2.http, dir: tmpDir(), retryMs: 5 });
        await s2.prime();
        s2.markState((st) => { st.a = 1; });
        assert.strictEqual(await s2.flush(60), false);
        assert.strictEqual(s2.pending(), 1);
    });

    await t("đọc lại kho giữa lúc còn thao tác chưa ghi: bộ nhớ không quên thay đổi của mình", async () => {
        const D = fakeDashboard({ failPosts: 1000 });
        const s = createStore({ http: D.http, dir: tmpDir(), retryMs: 5 });
        await s.prime();
        s.saveGroup("SG", { id: "222", name: "TEST" }, "trang");
        s.markState((st) => { st.gioiThieu = { 222: "x" }; });
        D.db.state.set("moc\u0000ads:SG:13:00", { section: "moc", item: "ads:SG:13:00", value: "2026-11-16" });   // tiến trình khác ghi
        await s.refresh();
        assert.strictEqual(s.readGroup("SG").id, "222");
        assert.strictEqual(s.loadState().gioiThieu["222"], "x");
        assert.strictEqual(s.loadState().moc["ads:SG:13:00"], "2026-11-16", "thấy cả thứ tiến trình khác vừa ghi");
    });

    await t("phiên: không đổi thì không ghi lại; bỏ ghép xoá; --dry-run không ghi gì", async () => {
        const D = fakeDashboard();
        const s = createStore({ http: D.http, dir: tmpDir() });
        await s.prime();
        const sess = { cookie: [{ key: "zpw" }], imei: "i", userAgent: "ua", language: "vi", name: "Hoàng Rin", savedAt: "a" };
        s.setSession(sess);
        s.setSession({ ...sess, savedAt: "b" });               // keepAlive mỗi giờ: chỉ giờ lưu khác
        assert.ok(await s.flush());
        assert.strictEqual(opsOf(D.posts).filter((o) => o.type === "session_set").length, 1);
        s.clearSession();
        assert.ok(await s.flush());
        assert.strictEqual(D.db.session, null);
        const ro = createStore({ http: D.http, dir: tmpDir(), readOnly: true });
        await ro.prime();
        const before = D.posts.length;
        ro.markState((st) => { st.a = 1; }); ro.saveGroup("TW", { id: "1", name: "x" });
        assert.ok(await ro.flush());
        assert.strictEqual(D.posts.length, before);
    });

    await t("lần đầu: chép 3 loại file cũ vào kho, soát khớp rồi xoá file", async () => {
        const dir = tmpDir();
        const state = { gioiThieu: { 394918045257421366: "2026-11-16T09:49:12Z" }, moc: { "ads:TW:18:00": "2026-11-16" }, nhomTuTrang: "2026-11-16T09:57Z", soMoc: { "TW|13:00": { so: { a: 1, b: 2 } } } };
        const session = { cookie: [{ key: "zpw_sek", value: "x" }], imei: "imei-1", userAgent: "ua", language: "vi", name: "Hoàng Rin" };
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
        fs.writeFileSync(path.join(dir, ".zalo_session.json"), JSON.stringify(session));
        fs.writeFileSync(path.join(dir, "zalo_group_nuoc_tw.json"), JSON.stringify({ id: "5092035087637680474", name: "ADS + VẬN ĐƠN TAIWAN", nuoc: "TW", chonLuc: "2026-11-16T09:57:59.179Z", cach: "trang" }));
        const D = fakeDashboard();
        const logs = [];
        const s = createStore({ http: D.http, dir, log: (...a) => logs.push(a.join(" ")) });
        await s.prime();
        assert.deepStrictEqual(fs.readdirSync(dir), [], "file cũ đã xoá");
        assert.strictEqual(canon(s.loadState()), canon(state));
        assert.strictEqual(s.getSession().name, "Hoàng Rin");
        assert.deepStrictEqual(s.readGroup("TW"), { id: "5092035087637680474", name: "ADS + VẬN ĐƠN TAIWAN", method: "trang", chosen_at: "2026-11-16T09:57:59.179Z" });
        assert.ok(logs.some((l) => /Đã chuyển vào database/.test(l)));
    });

    await t("kho đã có phiên khác: KHÔNG đè, giữ file cũ để xem tay", async () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, ".zalo_session.json"), JSON.stringify({ cookie: ["cu"], imei: "a", userAgent: "u", name: "Sỹ Anh" }));
        const D = fakeDashboard({ initial: { session: { cookie: ["moi"], imei: "b", userAgent: "u", name: "Hoàng Rin" } } });
        const logs = [];
        const s = createStore({ http: D.http, dir, log: (...a) => logs.push(a.join(" ")) });
        await s.prime();
        assert.strictEqual(s.getSession().name, "Hoàng Rin");
        assert.ok(fs.existsSync(path.join(dir, ".zalo_session.json")));
        assert.ok(logs.some((l) => /GIỮ file cũ/.test(l)));
    });

    await t("dashboard chưa lên lúc chạy tay: thử vài lần rồi báo lỗi, không đoán state", async () => {
        const s = createStore({ http: { get: async () => { throw new Error("fetch failed"); }, post: async () => ({}) }, dir: tmpDir() });
        const origSetTimeout = global.setTimeout;
        global.setTimeout = (fn) => origSetTimeout(fn, 0);      // bỏ thời gian chờ giữa các lượt
        try { await assert.rejects(s.prime({ maxAttempts: 3 }), /không đọc được kho bot/); }
        finally { global.setTimeout = origSetTimeout; }
        assert.strictEqual(s.isLoaded(), false);
    });

    console.log(`bot_store.test.js: ${ok}/${ok} PASS`);
})().catch((e) => { console.error(e); process.exit(1); });
