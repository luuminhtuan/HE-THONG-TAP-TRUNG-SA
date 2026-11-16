// ═══════════════════════════════════════════════════════════════════
// Điều khiển bot từ trang /admin → Khoá kết nối → Zalo (16/11/2026).
//
// Trang ghi YÊU CẦU vào bảng zalo_requests; ở đây bot nhặt từng cái (GET /api/talpha/zalo/bot?claim=1, chìa nội bộ),
// làm, rồi ghi kết quả + TRẠNG THÁI (POST /api/talpha/zalo/bot) — như nút "Cập nhật ngay" với lịch việc nền:
//   pair            ghép nick phụ bằng mã QR — ảnh QR đẩy lên trang để quét từ xa; phiên lưu vào bảng zalo_session
//   refresh_groups  đọc lại danh sách nhóm nick phụ đang ở
//   set_group       chọn nhóm nhận tin của một nước (bảng zalo_market_groups, như `node pair.js --chon-nuoc`)
//   send_test       gửi một tin thử vào nhóm của một nước
//   unpair          bỏ ghép: tắt phiên, xoá phiên trong kho
// Phiên / nhóm / trạng thái nằm trong database qua bot_store.js — việc nào đổi chúng thì ĐỢI ghi xong mới báo "xong".
// Nhịp tim mỗi 30 giây — trang biết bot còn chạy không.
//
// createControl() nhận phụ thuộc từ ngoài (phiên, zca-js, http) để thử được mà không đăng nhập Zalo — bot_control.test.js.
// ═══════════════════════════════════════════════════════════════════
const { B } = require("./zalo_text");

const CONTROL_PATH = "/api/talpha/zalo/bot";
const POLL_MS = 3000, HEARTBEAT_MS = 30_000;

const toGroupMap = (groups) => Object.fromEntries(Object.entries(groups || {})
    .filter(([, g]) => g && g.id).map(([m, g]) => [m, { id: String(g.id), name: g.name || "" }]));

function testMessage(market, info, at) {
    const when = at.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    const name = info ? `${info.flag ? info.flag + " " : ""}${info.ten || market}` : market;
    return `✅ ${B("TIN THỬ — bot Zalo ANTALO")}\nNhóm này nhận báo cáo ads + vận đơn ${name}.\nGửi thử từ trang Quản trị lúc ${when}.`;
}

/**
 * session — bot_session.js (connect, getMarketGroups, loadGroups, enqueue, sendOne, isLoggedIn, resetSession, logout,
 *           wakeUp, markPageManaged, pruneGroups, markIntroduced, getLoginProblem)
 * zalo    — zalo.js (pairByQr, listGroups, saveMarketGroup, removeMarketGroup, sessionAccountName)
 *
 * Nhóm do TRANG quản lý: ghép nick / chọn nhóm ở đây thì bot thôi tự nhận nhóm theo tên và thôi tự gửi tin giới
 * thiệu — chỉ gửi vào nhóm người chọn, tin thử chỉ khi bấm "Gửi thử". (16/11/2026: ghép một nick đang ở sẵn nhóm
 * thật của team, bot tự nhận 4 nhóm và nhắn giới thiệu vào cả 4 ngay lúc ghép.)
 * http    — {get(path), post(path, body)} → JSON
 * store   — bot_store.js (flush): đợi phiên / nhóm vừa đổi ghi xong vào database
 */
function createControl({ session, zalo, http, log, markets, marketInfo = {}, now = () => new Date(), store = { flush: async () => true } }) {
    /** Đợi thay đổi phiên / nhóm ghi xong vào database — chưa ghi được thì báo lỗi chứ không báo "xong". */
    async function persisted(what) {
        if (!(await store.flush())) throw new Error(`chưa lưu được ${what} vào database (dashboard không trả lời) — bot vẫn thử ghi lại`);
    }
    // Mất đăng nhập (cookie chết, Zalo đóng kết nối — bot_session.js): logged_in = false + last_error để trang hiện
    // băng đỏ. Đăng nhập lại được thì xoá đúng dòng lỗi mình đã ghi (lỗi khác của last_error giữ nguyên).
    let reportedLoginProblem = false;
    function loginStatus() {
        const problem = session.getLoginProblem ? session.getLoginProblem() : null;
        if (problem) {
            reportedLoginProblem = true;
            const vn = new Date(Date.parse(problem.since) + 7 * 3600000).toISOString();      // giờ VN, "HH:MM dd/mm"
            const since = `${vn.slice(11, 16)} ${vn.slice(8, 10)}/${vn.slice(5, 7)}`;
            return { logged_in: false, last_error: `Mất đăng nhập Zalo từ ${since}: ${problem.error}`
                + (problem.needsQr ? " — cần ghép lại nick (quét QR)" : " — bot đang tự thử lại") };
        }
        const status = { logged_in: session.isLoggedIn() || !!zalo.sessionAccountName() };
        if (reportedLoginProblem) { reportedLoginProblem = false; status.last_error = null; }
        return status;
    }
    async function pushStatus(patch = {}) {
        await http.post(CONTROL_PATH, { status: {
            ...loginStatus(),
            account_name: zalo.sessionAccountName(),
            markets,
            market_groups: toGroupMap(session.getMarketGroups()),
            ...patch,
        } });
    }
    const pairingStatus = (stage, message, qrPng = null) => pushStatus({ pairing: { stage, message, qr_png: qrPng, at: now().toISOString() } });

    async function readGroups() {
        return zalo.listGroups(await session.connect());
    }

    const handlers = {
        async pair() {
            await pairingStatus("qr", "Đang xin mã QR…");
            const { name } = await zalo.pairByQr({
                onEvent: async (ev) => {
                    if (ev.stage === "qr") await pairingStatus("qr", `Mã ${ev.attempt}/${ev.maxAttempts}`, ev.qrPng);
                    else if (ev.stage === "scanned") await pairingStatus("scanned", `Đã quét bởi "${ev.name}" — bấm XÁC NHẬN đăng nhập trên điện thoại`);
                },
            });
            await persisted("phiên đăng nhập");
            session.resetSession();              // bỏ phiên cũ (nếu đang ghép nick khác) — connect() đọc phiên vừa ghép
            session.markPageManaged();
            const groups = await readGroups();
            const dropped = session.pruneGroups(groups);   // nhóm chọn cho nick cũ mà nick này không ở → bỏ
            await persisted("nhóm");
            const note = dropped.length ? ` · bỏ nhóm cũ của ${dropped.join(", ")} (nick này không ở trong)` : "";
            await pushStatus({ groups, last_error: null, pairing: { stage: "done", message: `Đã ghép nick "${name}" · nick đang ở ${groups.length} nhóm${note}. Chọn nhóm cho từng nước ở dưới.`, qr_png: null } });
            session.wakeUp();
            return `Đã ghép nick "${name}" · ${groups.length} nhóm${note}`;
        },

        async refresh_groups() {
            const groups = await readGroups();
            const dropped = session.pruneGroups(groups);
            await pushStatus({ groups });
            return `Nick đang ở ${groups.length} nhóm${dropped.length ? ` · bỏ nhóm của ${dropped.join(", ")} (nick không còn ở trong)` : ""}`;
        },

        async set_group({ market, group_id: groupId }) {
            if (!markets.includes(market)) throw new Error(`bot không phục vụ nước ${market}`);
            session.markPageManaged();
            if (!groupId) {                       // chọn "chưa có nhóm" → nước đó thôi nhận tin
                zalo.removeMarketGroup(market);
                await persisted(`nhóm ${market}`);
                session.loadGroups();
                await pushStatus();
                return `Bỏ nhóm ${market} — không gửi gì cho ${market}`;
            }
            const groups = await readGroups();
            const group = groups.find((g) => String(g.id) === String(groupId));
            if (!group) throw new Error("nick phụ không ở nhóm này — thêm nick vào nhóm rồi tải lại danh sách");
            zalo.saveMarketGroup(market, group, "trang");
            session.markIntroduced(group.id);     // không tự nhắn giới thiệu — muốn thì bấm "Gửi thử"
            await persisted(`nhóm ${market}`);
            session.loadGroups();
            await pushStatus({ groups });
            session.wakeUp();
            return `Nhóm ${market}: "${group.name}" — nhận báo cáo theo lịch từ mốc kế tiếp`;
        },

        async send_test({ market }) {
            const group = session.getMarketGroups()[market];
            if (!group) throw new Error(`chưa chọn nhóm cho ${market}`);
            const groups = await readGroups();
            if (!groups.some((g) => String(g.id) === String(group.id))) {
                throw new Error(`nick đang ghép không ở nhóm "${group.name}" — chọn lại nhóm cho ${market}`);
            }
            await session.enqueue(() => session.sendOne(testMessage(market, marketInfo[market], now()), group));
            return `Đã gửi tin thử vào "${group.name}"`;
        },

        async unpair() {
            session.logout();
            await persisted("việc bỏ ghép");
            await pushStatus({ logged_in: false, account_name: null, groups: [], pairing: null });
            return "Đã bỏ ghép — bot ngừng gửi tới khi ghép lại";
        },
    };

    let busy = false;
    /** Một lượt: nhặt MỘT yêu cầu, làm, ghi kết quả. Đang làm dở (ghép nick chờ quét) thì lượt sau bỏ qua. */
    async function pollOnce() {
        if (busy) return null;
        busy = true;
        try {
            const { request } = await http.get(`${CONTROL_PATH}?claim=1`);
            if (!request) return null;
            const handler = handlers[request.action];
            let ok = false, result;
            try {
                if (!handler) throw new Error(`việc lạ: ${request.action}`);
                result = await handler(request.payload || {});
                ok = true;
            } catch (e) {
                result = e.message;
                const patch = { last_error: `${request.action}: ${e.message}` };
                if (request.action === "pair") patch.pairing = { stage: "failed", message: `Ghép không được: ${e.message}`, qr_png: null, at: now().toISOString() };
                await pushStatus(patch).catch(() => {});
            }
            await http.post(CONTROL_PATH, { finish: { id: request.id, ok, result } });
            log(`Trang yêu cầu ${request.action}${request.payload && request.payload.market ? " " + request.payload.market : ""}: ${ok ? "xong" : "lỗi"} — ${result}`);
            return { ok, result };
        } catch (e) {
            log("Điều khiển từ trang lỗi:", e.message);
            return null;
        } finally {
            busy = false;
        }
    }

    function start() {
        pushStatus().catch((e) => log("Ghi trạng thái lên trang lỗi:", e.message));
        setInterval(() => { pollOnce(); }, POLL_MS);
        setInterval(() => { pushStatus().catch((e) => log("Ghi trạng thái lên trang lỗi:", e.message)); }, HEARTBEAT_MS);
    }

    return { pollOnce, pushStatus, start, handlers };
}

/** Bot dịch vụ (bot_main.js) gọi: nối phụ thuộc thật rồi chạy vòng nhặt yêu cầu + nhịp tim. */
function startControl() {
    const session = require("./bot_session");
    const { log, MARKET_CODES } = require("./bot_config");
    const { MARKETS } = require("./rules");
    const { dashboardHttp, getStore } = require("./bot_store");
    const control = createControl({ session, zalo: require("./zalo"), http: dashboardHttp(), log, markets: MARKET_CODES,
        marketInfo: MARKETS, store: getStore() });
    control.start();
    return control;
}

module.exports = { createControl, startControl, testMessage, CONTROL_PATH };
