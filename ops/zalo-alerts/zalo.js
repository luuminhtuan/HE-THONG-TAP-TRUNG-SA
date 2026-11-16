// Kết nối Zalo bằng tài khoản PHỤ qua zca-js — thư viện KHÔNG chính thức, giả làm Zalo Web.
//
// Hệ quả phải biết (Sỹ Anh chọn cách này 15/09/2026, đã được nói rõ rủi ro):
//   - Trái điều khoản Zalo, nick có thể bị khoá → chỉ dùng nick PHỤ, không dùng nick chính.
//   - Zalo chỉ cho MỘT phiên web mỗi nick: mở Zalo Web / Zalo PC bằng nick phụ ở máy khác
//     là phiên của bot bị đá ra, bot im lặng cho tới khi ghép lại (`node pair.js`).
//   - Phiên (cookie + imei + userAgent) là KHOÁ ĐĂNG NHẬP: từ 16/11/2026 nằm trong database (bảng
//     zalo_session, MÃ HOÁ như khoá kết nối — bot_store.js; trước là file .zalo_session.json). Không in ra log.
const fs = require("fs");
const { Zalo, ThreadType } = require("zca-js");
const { toZalo, splitMessage } = require("./zalo_text");
const { getStore } = require("./bot_store");

// MỖI NƯỚC MỘT NHÓM "ADS + VẬN ĐƠN <nước>" (Sỹ Anh chốt 08/10/2026) — tin ads của nước đó
// và tin vận đơn của nước đó chung một nhóm. Nhóm từng nước nằm trong bảng zalo_market_groups (16/11/2026 —
// trước là file zalo_group_nuoc_<mã>.json): chọn ở /admin → Khoá kết nối → Zalo, hoặc `node pair.js --tu-nhan`
// (theo tên nhóm) / `--chon-nuoc <id> --nuoc TW`.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// checkUpdate: false — không gọi npm mỗi lần đăng nhập. logging: false — log của bot tự lo.
// selfListen: true — người cầm điện thoại nick phụ gõ /baocao cũng phải được nghe. Tin
// báo cáo của chính bot cũng lọt vào, nhưng không bắt đầu bằng "/" nên bộ đọc lệnh bỏ qua.
const createZalo = () => new Zalo({ selfListen: true, checkUpdate: false, logging: false });

/** Lưu lại phiên từ api đang chạy (cookie Zalo có thể được làm mới sau đăng nhập). Không đổi thì không ghi. */
function saveSession(api, extra = {}) {
    const previous = getStore().getSession() || {};
    const ctx = api.getContext();
    const jar = ctx.cookie && typeof ctx.cookie.toJSON === "function" ? ctx.cookie.toJSON() : null;
    getStore().setSession({
        ...previous, ...extra,
        imei: ctx.imei || previous.imei,
        userAgent: ctx.userAgent || previous.userAgent,
        language: ctx.language || previous.language || "vi",
        cookie: (jar && jar.cookies) || previous.cookie,
        savedAt: new Date().toISOString(),
    });
}

const MAX_QR_ATTEMPTS = 5;

/**
 * Ghép nick phụ bằng mã QR — dùng chung cho `node pair.js` và trang /admin → Khoá kết nối → Zalo (bot_control.js).
 * onEvent nhận {stage: "qr", qrPng, attempt} · {stage: "expired", final} · {stage: "scanned", name} ·
 * {stage: "declined"} · {stage: "saved"}. qrPath (tuỳ chọn): ghi thêm mã ra file PNG. Trả {api, name}.
 * Phiên ghi NGAY khi Zalo trả (GotLoginInfo), chưa đợi đăng nhập xong: bước sau hỏng thì không phải quét lại.
 * Ghi vào kho (bảng zalo_session) — bên gọi đợi getStore().flush() nếu cần chắc đã lưu.
 */
async function pairByQr({ qrPath = null, onEvent = async () => {} } = {}) {
    const { LoginQRCallbackEventType: E } = require("zca-js");
    let attempts = 0, displayName = "";
    let api;
    try {
        api = await createZalo().loginQR(qrPath ? { qrPath } : {}, async (ev) => {
            switch (ev.type) {
                case E.QRCodeGenerated:
                    attempts++;
                    if (qrPath) await ev.actions.saveToFile(qrPath);
                    await onEvent({ stage: "qr", qrPng: ev.data.image, attempt: attempts, maxAttempts: MAX_QR_ATTEMPTS });
                    break;
                case E.QRCodeExpired: {
                    const final = attempts >= MAX_QR_ATTEMPTS;
                    await onEvent({ stage: "expired", attempt: attempts, final });
                    if (final) ev.actions.abort(); else ev.actions.retry();
                    break;
                }
                case E.QRCodeScanned:
                    displayName = (ev.data && ev.data.display_name) || "";
                    await onEvent({ stage: "scanned", name: displayName });
                    break;
                case E.QRCodeDeclined:
                    await onEvent({ stage: "declined" });
                    ev.actions.abort();
                    break;
                case E.GotLoginInfo:
                    getStore().setSession({ ...ev.data, language: "vi", name: displayName, savedAt: new Date().toISOString() });
                    await onEvent({ stage: "saved" });
                    break;
            }
        });
    } catch (e) {
        throw new Error(attempts >= MAX_QR_ATTEMPTS ? `mã QR hết hạn ${attempts} lần — chưa ai quét` : `không ghép được (${e.message})`);
    }
    saveSession(api, { name: displayName });
    if (qrPath) { try { fs.unlinkSync(qrPath); } catch { /* chưa có file */ } }
    return { api, name: displayName };
}

/** Tên nick đã ghép (ghi lúc ghép) — null nếu chưa ghép. */
function sessionAccountName() {
    const s = getStore().getSession();
    return s && s.cookie ? (s.name || null) : null;
}

/** Bỏ ghép: xoá phiên trong kho. Lần đăng nhập sau báo "chưa ghép nick". */
function removeSession() {
    getStore().clearSession();
}

/** Đăng nhập bằng phiên đã ghép (đọc lại từ kho — `node pair.js` có thể vừa ghép). Chưa ghép → lỗi nói rõ phải làm gì. */
async function login() {
    const s = await getStore().refreshSession();
    if (!s || !s.imei || !s.cookie || !s.userAgent) {
        throw new Error("chưa ghép nick Zalo — ghép ở /admin → Khoá kết nối → Zalo (hoặc `node pair.js`) rồi quét QR");
    }
    const api = await createZalo().login({ imei: s.imei, cookie: s.cookie, userAgent: s.userAgent, language: s.language || "vi" });
    saveSession(api);
    return api;
}

/** Nhóm "ADS + VẬN ĐƠN" của một nước ({id, name, method, chosen_at}). null = chưa chọn → bot không gửi gì cho nước đó. */
const readMarketGroup = (m) => getStore().readGroup(String(m).toUpperCase());

/** Chọn nhóm cho một nước (method: trang · tu-nhan · chon-tay). Bên gọi đợi getStore().flush() nếu cần chắc đã lưu. */
const saveMarketGroup = (m, g, method = "") => getStore().saveGroup(m, g, method);

/** Bỏ nhóm của một nước — nước đó không nhận tin nữa tới khi chọn lại. */
const removeMarketGroup = (m) => getStore().removeGroup(m);

async function listGroups(api) {
    const { gridVerMap } = await api.getAllGroups();
    const ids = Object.keys(gridVerMap || {});
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const info = await api.getGroupInfo(ids.slice(i, i + 50));
        for (const [id, g] of Object.entries(info.gridInfoMap || {})) {
            out.push({ id, name: g.name || "(không tên)", members: g.totalMember });
        }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** Gửi một bản tin vào nhóm: đổi chữ đậm sang style Zalo, dài quá thì chia nhiều tin. */
async function sendToGroup(api, groupId, text, { maxChars = 1800, sendGapMs = 4000 } = {}) {
    const parts = splitMessage(toZalo(text), maxChars);
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const isRich = p.styles.length || (p.mentions && p.mentions.length);
        await api.sendMessage(isRich ? { msg: p.msg, styles: p.styles, mentions: p.mentions || [] } : p.msg, groupId, ThreadType.Group);
        if (i < parts.length - 1) await sleep(sendGapMs);
    }
    return parts.length;
}

/**
 * Nghe tin trong các nhóm để bắt lệnh. zca-js tự nối lại khi rớt mạng (retryOnClose);
 * "closed" chỉ phát khi nó THÔI nối — thường vì có phiên web khác của nick phụ chen vào
 * (mở Zalo Web / Zalo PC). Bên gọi quyết định đăng nhập lại lúc nào.
 */
function startListening(api, { onMessage, onClosed, log }) {
    const l = api.listener;
    l.on("connected", () => log("Bộ nhận lệnh Zalo đã kết nối."));
    l.on("message", onMessage);
    l.on("error", (e) => log("Bộ nhận lệnh lỗi:", (e && e.message) || e));
    l.on("closed", (code, reason) => onClosed(l, code, reason));
    l.start({ retryOnClose: true });
    return l;
}

module.exports = {
    MAX_QR_ATTEMPTS, ThreadType,
    createZalo, saveSession, pairByQr, sessionAccountName, removeSession,
    login, readMarketGroup, saveMarketGroup, removeMarketGroup, listGroups, sendToGroup, startListening,
};
