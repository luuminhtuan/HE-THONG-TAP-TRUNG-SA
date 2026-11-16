// ═══════════════════════════════════════════════════════════════════
// Kho của bot trong Postgres (16/11/2026) — thay ba loại file trên máy chạy bot (migration 0003):
//   .zalo_session.json          → zalo_session        (MÃ HOÁ phía dashboard, như khoá kết nối)
//   zalo_group_nuoc_<mã>.json   → zalo_market_groups
//   state.json                  → zalo_bot_state      (mỗi dòng một mục: section = khoá tầng một, item = tầng hai)
// Bot không nối thẳng Postgres: đọc / ghi qua dashboard (GET ?store=1, POST {store_ops}, /api/talpha/zalo/bot).
//
// Code cũ đọc ĐỒNG BỘ khắp nơi (loadState(), readMarketGroup()) nên kho nằm trong BỘ NHỚ: nạp một lần lúc khởi
// động (prime), đọc lại mỗi vòng rà (refresh — lệnh chạy tay `node bot.js --report`, `node pair.js` có thể vừa
// ghi). Ghi = sửa bộ nhớ ngay + xếp hàng gửi lên dashboard; hỏng thì GIỮ hàng, thử lại. flush() đợi hàng trống:
// trang bấm ghép nick / chọn nhóm thì đợi ghi xong mới báo "xong"; thoát tiến trình cũng đợi.
//
// Lần đầu chạy bản này mà file cũ còn trên máy: chép vào kho (chỉ chỗ kho còn trống), đọc lại soát khớp từng
// thứ, khớp mới xoá file — phiên đăng nhập không còn nằm trần trên đĩa.
// createStore() nhận phụ thuộc từ ngoài để thử được không cần dashboard — bot_store.test.js.
// ═══════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

const STORE_PATH = "/api/talpha/zalo/bot";
const LEGACY_SESSION = ".zalo_session.json";
const LEGACY_STATE = "state.json";
const LEGACY_GROUP_RE = /^zalo_group_nuoc_([a-z]+)\.json$/;
const BATCH = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** JSON với khoá xếp thứ tự — jsonb của Postgres đổi thứ tự khoá, so bằng chuỗi thường là lệch giả. */
const canon = (v) => JSON.stringify(v, (_, x) => (isPlainObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);

/** Dòng kho → object state như state.json cũ. item "" = giá trị đứng riêng của section (vd nhomTuTrang). */
function rowsToState(rows) {
    const st = {};
    for (const r of rows || []) {
        if (r.item === "") st[r.section] = r.value;
        else (isPlainObject(st[r.section]) ? st[r.section] : (st[r.section] = {}))[r.item] = r.value;
    }
    return st;
}

/** state → dòng kho. Section là object rỗng thì không có dòng nào (đọc lại thành "không có") — như nhau với code bot. */
function stateToRows(st) {
    const rows = [];
    for (const [section, v] of Object.entries(st || {})) {
        if (v === undefined) continue;
        if (isPlainObject(v)) {
            for (const [item, value] of Object.entries(v)) if (value !== undefined && item !== "") rows.push({ section, item, value });
        } else rows.push({ section, item: "", value: v });
    }
    return rows;
}

/** Hai bản state → thao tác ghi kho, CHỈ mục đổi: hai tiến trình sửa hai mục khác nhau không đè nhau. */
function diffState(before, after) {
    const ops = [];
    for (const section of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        const a = (before || {})[section], b = (after || {})[section];
        if (same(a, b)) continue;
        if (b === undefined) { ops.push({ type: "state_del", section, item: null }); continue; }
        if (isPlainObject(b)) {
            if (a !== undefined && !isPlainObject(a)) ops.push({ type: "state_del", section, item: "" });
            const prev = isPlainObject(a) ? a : {};
            for (const item of new Set([...Object.keys(prev), ...Object.keys(b)])) {
                if (item === "") continue;
                if (b[item] === undefined) { if (prev[item] !== undefined) ops.push({ type: "state_del", section, item }); }
                else if (!same(prev[item], b[item])) ops.push({ type: "state_set", section, item, value: b[item] });
            }
        } else {
            if (isPlainObject(a)) ops.push({ type: "state_del", section, item: null });
            ops.push({ type: "state_set", section, item: "", value: b });
        }
    }
    return ops;
}

// Phiên coi như KHÔNG đổi nếu cookie / imei / userAgent / tên như cũ — đăng nhập và keepAlive mỗi giờ không ghi lại.
const sessionCore = (s) => (s ? canon({ cookie: s.cookie, imei: s.imei, userAgent: s.userAgent, language: s.language, name: s.name }) : "");

function createStore({ http, log = () => {}, dir = __dirname, readOnly = false, retryMs = 5000, now = () => new Date() }) {
    let state = {}, groups = {}, session = null, loaded = false;
    const queue = [];
    let flushing = null;

    function kick() {
        if (flushing || !queue.length) return;
        flushing = (async () => {
            while (queue.length) {
                const batch = queue.slice(0, BATCH);
                try {
                    await http.post(STORE_PATH, { store_ops: batch });
                    queue.splice(0, batch.length);
                } catch (e) {
                    log(`Ghi kho bot lỗi (${queue.length} thao tác chờ) — thử lại sau ${retryMs / 1000}s:`, e.message);
                    await sleep(retryMs);
                }
            }
        })().finally(() => { flushing = null; kick(); });
    }
    function enqueue(ops) {
        if (readOnly || !ops.length) return;
        queue.push(...ops);
        kick();
    }

    /** Đợi hàng ghi trống. Hết hạn mà chưa xong → false (hàng vẫn giữ, vẫn thử lại). */
    async function flush(timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;
        kick();
        while (queue.length || flushing) {
            if (Date.now() >= deadline) return false;
            await Promise.race([flushing || sleep(50), sleep(Math.max(1, deadline - Date.now()))]);
        }
        return true;
    }

    async function fetchStore() {
        return http.get(`${STORE_PATH}?store=1`);
    }
    // Thao tác còn trong hàng (chưa ghi được / đang gửi) áp lại lên bản vừa đọc về — không thì đọc lại kho giữa
    // lúc trang vừa chọn nhóm là bộ nhớ quên nhóm đó tới lượt đọc sau.
    function replayPending({ only } = {}) {
        for (const op of queue) {
            if (only && !only.includes(op.type)) continue;
            const sec = state[op.section];
            switch (op.type) {
                case "state_set":
                    if (op.item === "") state[op.section] = clone(op.value);
                    else (isPlainObject(sec) ? sec : (state[op.section] = {}))[op.item] = clone(op.value);
                    break;
                case "state_del":
                    if (op.item === null || (op.item === "" && !isPlainObject(sec))) delete state[op.section];
                    else if (isPlainObject(sec)) delete sec[op.item];
                    break;
                case "group_set": groups[op.market] = { id: op.id, name: op.name, method: op.method, chosen_at: op.chosen_at }; break;
                case "group_del": delete groups[op.market]; break;
                case "session_set": session = clone(op.value); break;
                case "session_del": session = null; break;
            }
        }
    }
    function apply(d) {
        state = rowsToState(d.state_rows);
        groups = Object.fromEntries(Object.entries(d.market_groups || {}).map(([m, g]) => [m, { ...g }]));
        session = d.session && d.session.cookie ? d.session : null;
        replayPending();
        loaded = true;
    }
    /** Đọc lại cả kho (tiến trình khác có thể vừa ghi); thay đổi của mình chưa ghi xong vẫn giữ. */
    async function refresh() {
        apply(await fetchStore());
    }

    function readLegacy() {
        const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
        let names = [];
        try { names = fs.readdirSync(dir); } catch { /* không có thư mục */ }
        const groupFiles = names.filter((f) => LEGACY_GROUP_RE.test(f));
        const legacyGroups = {};
        for (const f of groupFiles) {
            const g = read(f);
            if (g && g.id) legacyGroups[String(g.nuoc || f.match(LEGACY_GROUP_RE)[1]).toUpperCase()] =
                { id: String(g.id), name: g.name || "", method: g.cach || null, chosen_at: g.chonLuc || null };
        }
        const s = read(LEGACY_SESSION);
        const st = read(LEGACY_STATE);
        return { session: s && s.cookie ? s : null, state: isPlainObject(st) ? st : null, groups: legacyGroups, groupFiles };
    }

    /** Chép file cũ vào kho (chỉ chỗ kho trống), soát khớp, khớp thì xoá file. Trả mô tả việc đã làm hoặc null. */
    async function importLegacyFiles() {
        if (readOnly) return null;
        const L = readLegacy();
        if (!L.session && !L.state && !Object.keys(L.groups).length) return null;
        await http.post(STORE_PATH, { import: {
            session: L.session && !session ? L.session : null,
            market_groups: Object.fromEntries(Object.entries(L.groups).filter(([m]) => !groups[m])),
            state_rows: L.state && !Object.keys(state).length ? stateToRows(L.state) : [],
        } });
        apply(await fetchStore());
        // Xoá file CHỈ khi kho đang giữ đúng thứ file có — kho đã có bản khác (file còn sót của lần khác) thì giữ file.
        const done = [], kept = [];
        const settle = (label, ok, files) => {
            if (!ok) { kept.push(label); return; }
            for (const f of files) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* đã xoá */ } }
            done.push(label);
        };
        if (L.session) settle("phiên đăng nhập", !!session && sessionCore(session) === sessionCore(L.session), [LEGACY_SESSION]);
        if (L.state) settle("trạng thái", same(rowsToState(stateToRows(L.state)), state), [LEGACY_STATE]);
        for (const f of L.groupFiles) {
            const m = Object.keys(L.groups).find((k) => f === `zalo_group_nuoc_${k.toLowerCase()}.json`);
            const ok = !m || (groups[m] && String(groups[m].id) === L.groups[m].id);
            settle(`nhóm ${m || f}`, ok, [f]);
        }
        if (done.length) log(`Đã chuyển vào database: ${done.join(", ")} — xoá file cũ trên máy.`);
        if (kept.length) log(`GIỮ file cũ (kho đã có bản khác): ${kept.join(", ")} — xem tay rồi xoá.`);
        return { done, kept };
    }

    /** Nạp kho lúc khởi động. Dịch vụ thì đợi tới khi dashboard lên (không đoán state — đoán sai là gửi lặp tin). */
    async function prime({ retryForever = false, maxAttempts = 6 } = {}) {
        for (let attempt = 1; ; attempt++) {
            try { apply(await fetchStore()); break; }
            catch (e) {
                if (!retryForever && attempt >= maxAttempts) throw new Error(`không đọc được kho bot từ dashboard (${e.message})`);
                const waitS = Math.min(60, attempt * 5);
                log(`Chưa đọc được kho bot từ dashboard (${e.message}) — thử lại sau ${waitS}s.`);
                await sleep(waitS * 1000);
            }
        }
        try { await importLegacyFiles(); }
        catch (e) { log("Chép file cũ của bot vào database lỗi — giữ file, lần khởi động sau thử lại:", e.message); }
    }

    return {
        prime, refresh, flush, importLegacyFiles,
        isLoaded: () => loaded,
        pending: () => queue.length,
        loadState: () => clone(state),
        /** Sửa state trong bộ nhớ rồi xếp hàng ghi đúng các mục đổi. */
        markState(mut) {
            const before = clone(state);
            mut(state);
            enqueue(diffState(before, state));
            return clone(state);
        },
        readGroup: (m) => (groups[m] && groups[m].id ? { ...groups[m] } : null),
        saveGroup(m, g, method = null) {
            const market = String(m).toUpperCase();
            const v = { id: String(g.id), name: g.name || "", method: method || null, chosen_at: now().toISOString() };
            groups[market] = v;
            enqueue([{ type: "group_set", market, ...v }]);
            return v;
        },
        removeGroup(m) {
            const market = String(m).toUpperCase();
            if (!groups[market]) return;
            delete groups[market];
            enqueue([{ type: "group_del", market }]);
        },
        getSession: () => clone(session),
        setSession(s) {
            if (sessionCore(s) === sessionCore(session)) { session = clone(s); return; }   // như cũ: không ghi lại
            session = clone(s);
            enqueue([{ type: "session_set", value: session }]);
        },
        clearSession() {
            if (!session) return;
            session = null;
            enqueue([{ type: "session_del" }]);
        },
        /** Đọc lại phiên trước khi đăng nhập (`node pair.js` có thể vừa ghép nick khác). Dashboard không trả lời thì dùng bản đang có. */
        async refreshSession() {
            try {
                const d = await fetchStore();
                session = d.session && d.session.cookie ? d.session : null;
                replayPending({ only: ["session_set", "session_del"] });
            } catch (e) { log("Không đọc lại được phiên từ dashboard — dùng phiên đang có:", e.message); }
            return clone(session);
        },
    };
}

/** Gọi dashboard bằng chìa nội bộ (config.js gắn x-talpha-token cho mọi fetch tới dashboard). */
function dashboardHttp() {
    const CFG = require("./config");
    const call = async (p, init = {}) => {
        const r = await fetch(`${CFG.dashboardBaseUrl}${p}`, { ...init, signal: AbortSignal.timeout(15_000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
    };
    return {
        get: (p) => call(p),
        post: (p, body) => call(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    };
}

// Một kho cho cả tiến trình (bot_config, zalo, bot_session, pair.js dùng chung). --dry-run: chỉ đọc, không ghi gì.
let shared = null;
function getStore() {
    if (!shared) {
        const log = (...a) => console.log(new Date().toISOString(), ...a);
        shared = createStore({ http: dashboardHttp(), log, readOnly: process.argv.includes("--dry-run") });
    }
    return shared;
}

module.exports = { createStore, getStore, dashboardHttp, rowsToState, stateToRows, diffState, canon, STORE_PATH };
