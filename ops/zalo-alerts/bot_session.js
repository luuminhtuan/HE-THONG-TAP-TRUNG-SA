// Phiên Zalo của bot.js (tách 16/11/2026): đăng nhập, hàng gửi tin, nhóm từng nước, bộ nhận lệnh.
// Biến phiên (zalo, api, nhóm) chỉ nằm ở đây; module khác đọc qua isLoggedIn() / getMarketGroups().
// Lệnh gõ trong nhóm chạy bằng runCommand của bot_commands.js — bot.js đưa vào qua
// enableServiceMode(): bot_commands.js require module này, require ngược lại là vòng.
const CFG = require("./config");
const { toZalo, splitMessage } = require("./zalo_text");
const { MARKETS, pickGroupsByName } = require("./rules");
const { DRY, MARKET_CODES, sleep, log, loadState, markState, helpMessage } = require("./bot_config");

// ─── Kết nối + gửi ───
// Đăng nhập lười: chỉ khi có tin cần gửi. Gửi hỏng thì bỏ phiên trong bộ nhớ, đăng nhập lại
// một lần rồi gửi lại — phiên web của Zalo hay rớt khi Zalo đổi máy chủ.
let zalo = null;           // require("./zalo") muộn: --dry-run chạy được cả khi chưa cài zca-js
let api = null;
let marketGroups = {};         // mã nước → nhóm "ADS + VẬN ĐƠN <nước>"; thiếu = không gửi gì cho nước đó
let serviceMode = false;        // chạy dịch vụ thì mỗi lần đăng nhập đều bật lại bộ nhận lệnh
let runCommand = null;          // runCommand của bot_commands.js — có khi bật dịch vụ (enableServiceMode)

// bot.js gọi lúc chạy dịch vụ: từ đó mỗi lần đăng nhập đều bật lại bộ nhận lệnh.
function enableServiceMode(commandRunner) {
    serviceMode = true;
    runCommand = commandRunner;
}
// Nạp ./zalo (zca-js) — chỉ khi chạy thật; --dry-run không cần.
function loadZalo() { zalo = require("./zalo"); }
const isLoggedIn = () => !!api;
// Đọc lại mỗi lần: loadGroups() thay cả object.
const getMarketGroups = () => marketGroups;

async function connect() {
    if (!zalo) zalo = require("./zalo");
    if (!api) {
        api = await zalo.login();
        log("Đã đăng nhập Zalo.");
        if (serviceMode) startListener(api);
    }
    return api;
}

async function sendOne(text, group) {
    if (DRY) {
        const parts = splitMessage(toZalo(text), CFG.maxChars || 1800);
        parts.forEach((p, i) => {
            const boldParts = p.styles.filter((s) => s.st === "b").map((s) => p.msg.slice(s.start, s.start + s.len));
            console.log(`\n──── tin${group ? ` → "${group.name}"` : ""}${parts.length > 1 ? ` (phần ${i + 1}/${parts.length})` : ""} · ${p.msg.length} ký tự ────\n${p.msg}`);
            if (boldParts.length) console.log(`   [chữ đậm: ${boldParts.join(" | ")}]`);
        });
        return parts.length;
    }
    if (!group) throw new Error("chưa có nhóm nhận tin — chạy `node pair.js --tu-nhan`");
    const opts = { maxChars: CFG.maxChars, sendGapMs: CFG.sendGapMs };
    // ketNoi() TRƯỚC rồi mới đọc zalo.guiNhom: viết gộp `zalo.guiNhom(await ketNoi(), …)`
    // thì JS đọc zalo.guiNhom trước khi ketNoi() kịp nạp module.
    let a = await connect();
    try {
        return await zalo.sendToGroup(a, group.id, text, opts);
    } catch (e) {
        log("Gửi lỗi, đăng nhập lại rồi thử một lần nữa:", e.message);
        api = null;
        a = await connect();
        return zalo.sendToGroup(a, group.id, text, opts);
    }
}

// Mọi lần gửi xếp MỘT hàng: hai người gõ lệnh cùng lúc, hay lệnh rơi đúng lúc tin 8h30
// đang gửi, thì loạt sau đợi loạt trước — không xen tin của hai loạt vào nhau.
let sendQueue = Promise.resolve();
function enqueue(fn) {
    const p = sendQueue.then(fn);
    sendQueue = p.catch(() => {});
    return p;
}

/** Gửi lần lượt. Trả số tin đã gửi được; hỏng giữa chừng thì dừng và ném lỗi kèm số đó. */
async function sendBatch(texts, group) {
    let sentCount = 0;
    for (const t of texts.filter(Boolean)) {
        if (sentCount > 0 && !DRY) await sleep(CFG.sendGapMs || 4000);
        try { await sendOne(t, group); }
        catch (e) { e.daGui = sentCount; throw e; }
        sentCount++;
    }
    return sentCount;
}

// Nhóm của nước m; dry-run không cần nhóm thật (chỉ in) — đặt tên giả để dòng in ghi rõ nước.
const groupOf = (m) => marketGroups[m] || (DRY ? { id: "", name: `ADS + VẬN ĐƠN ${m} (in thử)` } : null);

// Chỉ nghe ĐÚNG các nhóm nước. Nick phụ còn ở các nhóm COD có người của đối tác, và ở nhóm cũ
// (BÁO CÁO ADS, VẬN ĐƠN …) — gõ /baocao ở đó bot im, không lộ số ra ngoài.
function handleMessage(msg) {
    if (!zalo || msg.type !== zalo.ThreadType.Group) return;
    const m = Object.keys(marketGroups).find((x) => marketGroups[x] && marketGroups[x].id === msg.threadId) || null;
    if (!m) return;
    const text = typeof msg.data.content === "string" ? msg.data.content : "";
    if (!text.trim().startsWith("/")) return;
    runCommand(text, msg.data.dName || msg.data.uidFrom, m).catch((e) => log("Lỗi xử lý lệnh:", e.message));
}

// Bộ nhận lệnh gắn với MỘT phiên đăng nhập. Đăng nhập lại là thay bộ mới. Bộ nghe bị Zalo
// đóng hẳn (thường do mở Zalo Web/PC bằng nick phụ) thì đợi rồi đăng nhập lại, đợi dài dần
// để không giành phiên qua lại với người đang dùng Zalo Web.
const RETRY_INITIAL_MS = 10 * 60 * 1000, RETRY_MAX_MS = 2 * 60 * 60 * 1000;
let listener = null;
let retryDelay = RETRY_INITIAL_MS;

function startListener(a) {
    const previous = listener;
    listener = null;
    if (previous) { try { previous.stop(); } catch { /* bộ cũ đã chết */ } }
    const latest = zalo.startListening(a, {
        onMessage: handleMessage,
        log,
        onClosed: (l, code, reason) => {
            if (l !== listener) return;                     // bộ cũ vừa bị thay — không phải sự cố
            listener = null;
            api = null;
            const delay = retryDelay;
            retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
            log(`Bộ nhận lệnh bị đóng (mã ${code}${reason ? ", " + reason : ""}) — thường do mở Zalo Web/PC bằng nick phụ. Đăng nhập lại sau ${Math.round(delay / 60000)}'.`);
            setTimeout(() => { if (!api) connect().catch((e) => log("Đăng nhập lại lỗi:", e.message)); }, delay);
        },
    });
    latest.on("connected", () => { retryDelay = RETRY_INITIAL_MS; });
    listener = latest;
}

// ─── Điều khiển từ trang (bot_control.js, 16/11/2026) ───
/** Bỏ phiên trong bộ nhớ (ghép nick khác xong, hoặc bỏ ghép): tắt bộ nhận lệnh, lần sau connect() đọc lại phiên. */
function resetSession() {
    const previous = listener;
    listener = null;                     // onClosed của bộ cũ thấy l !== listener → không hẹn đăng nhập lại
    if (previous) { try { previous.stop(); } catch { /* bộ cũ đã chết */ } }
    api = null;
}

/** Bỏ ghép: tắt phiên + xoá file phiên trên máy này. Nhóm đã chọn giữ nguyên (ghép lại là gửi tiếp). */
function logout() {
    resetSession();
    if (!zalo) zalo = require("./zalo");
    zalo.removeSession();
}

// Vòng chờ lúc khởi động (bot_main.js) đợi tới 10' mỗi lượt — ghép nick / chọn nhóm trên trang thì đánh thức ngay.
let wake = null;
function waitOrWake(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => { wake = null; resolve(); }, ms);
        wake = () => { clearTimeout(timer); wake = null; resolve(); };
    });
}
function wakeUp() { if (wake) wake(); }

async function keepSessionAlive() {
    if (!api) return;
    try { await api.keepAlive(); zalo.saveSession(api); }
    catch (e) { log("keepAlive lỗi — lần gửi tới sẽ đăng nhập lại:", e.message); api = null; }
}

// Nhóm do trang /admin → Khoá kết nối → Zalo quản lý (16/11/2026): ghép nick / chọn nhóm trên trang là ghi cờ này —
// từ đó bot KHÔNG tự nhận nhóm theo tên, KHÔNG tự gửi tin giới thiệu: chỉ gửi vào nhóm người chọn. Ghép nick
// mà nick đó ở sẵn trong nhóm thật của team thì tự nhận + giới thiệu là nhắn vào nhóm thật ngay (đã xảy ra 16/11).
const PAGE_MANAGED_KEY = "nhomTuTrang";
const pageManaged = () => !!loadState()[PAGE_MANAGED_KEY];
function markPageManaged() { markState((s) => { s[PAGE_MANAGED_KEY] = new Date().toISOString(); }); }

/** Bỏ nhóm của nước mà nick ĐANG ghép không ở trong (đổi nick, bị kick khỏi nhóm) — gửi vào đó Zalo báo
 *  "Tham số không hợp lệ". Trả mã các nước vừa bỏ. */
function pruneGroups(groups) {
    if (!zalo) zalo = require("./zalo");
    const ids = new Set((groups || []).map((g) => String(g.id)));
    const dropped = [];
    for (const m of MARKET_CODES) {
        const g = zalo.readMarketGroup(m);
        if (g && !ids.has(String(g.id))) {
            zalo.removeMarketGroup(m);
            dropped.push(m);
            log(`Bỏ nhóm ${m} "${g.name}" — nick đang ghép không ở nhóm này.`);
        }
    }
    if (dropped.length) loadGroups();
    return dropped;
}

/** Lúc khởi động: đọc danh sách nhóm của nick đang ghép, bỏ nhóm nick không ở (file nhóm còn từ nick cũ). */
async function pruneStaleGroups() {
    if (!zalo) zalo = require("./zalo");
    return pruneGroups(await zalo.listGroups(await connect()));
}

/** Nhóm chọn trên trang: đánh dấu đã giới thiệu để bot không tự nhắn gì — người chọn bấm "Gửi thử" khi muốn. */
function markIntroduced(groupId) {
    markState((s) => { (s.gioiThieu = s.gioiThieu || {})[groupId] = new Date().toISOString(); });
}

async function introduceNewGroups() {
    if (pageManaged()) return;
    for (const m of MARKET_CODES) {
        const group = marketGroups[m];
        if (!group || (loadState().gioiThieu || {})[group.id]) continue;
        await enqueue(() => sendOne(helpMessage(m), group));
        markState((s) => { (s.gioiThieu = s.gioiThieu || {})[group.id] = new Date().toISOString(); });
        log(`Đã gửi tin giới thiệu vào nhóm "${group.name}".`);
    }
}

function loadGroups() {
    marketGroups = Object.fromEntries(MARKET_CODES.map((m) => [m, zalo.readMarketGroup(m)]).filter(([, g]) => g));
}

// Nước chưa có file nhóm → tìm trong các nhóm nick phụ đang ở, theo đúng mẫu tên "ADS + VẬN ĐƠN
// <nước>" (rules.nuocTuTenNhom). Một nước khớp hai nhóm trở lên thì KHÔNG đoán.
async function autoAssignGroups() {
    if (pageManaged()) return;           // nhóm do trang quản lý — chỉ người chọn trên trang
    const missing = MARKET_CODES.filter((m) => !marketGroups[m]);
    if (!missing.length) return;
    let allGroups;
    try { allGroups = await zalo.listGroups(await connect()); }
    catch (e) { log("Không đọc được danh sách nhóm để tự nhận:", e.message); return; }
    const { chon: picked, trung: ambiguous, thieu: stillMissing } = pickGroupsByName(allGroups, missing);
    for (const [m, g] of Object.entries(picked)) {
        zalo.saveMarketGroup(m, g, "tu-nhan");
        log(`Tự nhận nhóm ${m}: "${g.name}" (${g.id}).`);
    }
    for (const [m, xs] of Object.entries(ambiguous)) log(`${m}: ${xs.length} nhóm cùng mẫu tên — không tự chọn (${xs.map((g) => g.id).join(", ")}). Chọn tay: node pair.js --chon-nuoc <id> --nuoc ${m}`);
    for (const m of stillMissing) log(`${m}: nick phụ chưa ở nhóm "ADS + VẬN ĐƠN ${MARKETS[m].ten.toUpperCase()}" — chưa gửi gì cho ${m}.`);
    loadGroups();
}

module.exports = {
    enableServiceMode, loadZalo, isLoggedIn, getMarketGroups,
    connect, sendOne, enqueue, sendBatch, groupOf, startListener, keepSessionAlive, introduceNewGroups, loadGroups, autoAssignGroups,
    resetSession, logout, waitOrWake, wakeUp, pageManaged, markPageManaged, pruneGroups, pruneStaleGroups, markIntroduced,
};
