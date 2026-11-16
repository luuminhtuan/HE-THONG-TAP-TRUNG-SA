// Cấu hình chạy của bot.js (tách 16/11/2026): hằng lấy từ config.json + talpha_rules.json, cờ dòng
// lệnh, state.json, giờ Việt Nam, các mốc gửi, tin giới thiệu / trợ giúp. Chỉ khai hằng và hàm —
// require module này không đăng nhập, không gửi, không hẹn giờ gì.
const fs = require("fs");
const path = require("path");
const CFG = require("./config");
const { marketHelpMessage } = require("./commands");
const { toMin } = require("./schedule");
const { MARKETERS, DISPLAY, MARKETS } = require("./rules");

const DIR = __dirname;
const STATE_FILE = path.join(DIR, "state.json");
const ARGS = process.argv.slice(2);
const DRY = ARGS.includes("--dry-run");
const DR = CFG.dailyReport || {};
const SHIPMENT_CFG = CFG.vanDon || {};
const CORRECTION_DEADLINE_HOURS = Number(DR.dinhChinhHanGio) > 0 ? Number(DR.dinhChinhHanGio) : 24;   // hạn chờ đính chính
const MARKETER_LIST = Object.keys(MARKETERS).map((key) => ({ key, ten: DISPLAY[key] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ddmm = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(d || ""));

// Nước còn chạy: nước đã tắt (talpha_rules.json → status "da_tat", 04/11/2026) bị lọc khỏi MỌI lịch
// gửi dưới đây, kể cả khi config.json còn ghi tên nó — tắt nước chỉ cần sửa một chỗ.
const isActiveMarket = (m) => !!MARKETS[m] && !MARKETS[m].daTat;
// Nước có nhóm "ADS + VẬN ĐƠN" — thứ tự gửi trong một mốc.
const MARKET_CODES = ((CFG.nhomNuoc || {}).markets || Object.keys(MARKETS)).map((x) => String(x).toUpperCase()).filter(isActiveMarket);
// Nước có theo dõi vận đơn (Nhật chưa có).
const SHIPMENT_MARKETS = (Array.isArray(SHIPMENT_CFG.markets) && SHIPMENT_CFG.markets.length ? SHIPMENT_CFG.markets : ["TW"]).map((x) => String(x).toUpperCase()).filter(isActiveMarket);
// Nước Meta không báo số tin nhắn (Nhật): bản tin ads lấy mess từ Pancake (09/10/2026).
const MESS_PANCAKE = (((CFG.nhomNuoc || {}).messPancake) || []).map((x) => String(x).toUpperCase());
// Tin MỖI GIỜ (ads + tin nhắn Pancake + đơn theo page) — Sỹ Anh yêu cầu 09/10/2026 cho Nhật.
const HOURLY_CFG = CFG.moiGio || {};
const HOURLY_MARKETS = (HOURLY_CFG.markets || []).map((x) => String(x).toUpperCase()).filter(isActiveMarket);
// UAE không qua 17TRACK: đơn POS + tra thẳng trang WeShip (Sỹ Anh chốt 28/09/2026).
const SHIPMENT_SOURCES = { AE: "đơn POS + tra trang WeShip" };

function argAfter(flag) {
    const i = ARGS.indexOf(flag);
    const v = i >= 0 ? ARGS[i + 1] : "";
    return v && !v.startsWith("--") ? v : "";
}

// ─── State: ghi MỘT thay đổi nhỏ, đọc lại file ngay trước khi ghi ───
// Các vòng rà ôm state qua nhiều await mạng; ai ghi sau mà dùng bản cũ là xoá khoá của
// vòng kia — mốc đã gửi bị quên và vòng sau bắn lại tin thứ hai vào nhóm.
function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function markState(mut) {
    const st = loadState();
    mut(st);
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); }
    catch (e) { log("Lỗi ghi state:", e.message); }
    return st;
}

// ─── Giờ Việt Nam. hourCycle h23 BẮT BUỘC: hour12:false trả "24" lúc nửa đêm, báo cáo 8h
// của bot WhatsApp từng bắn lúc 0h05 vì đúng chuyện này. ───
const vnDateStr = () => new Date().toLocaleDateString("sv-SE", { timeZone: CFG.timezone });   // YYYY-MM-DD
const vnHHMM = () => new Date().toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
function inQuietHours() {
    const h = toMin(vnHHMM()) / 60;
    const { quietStartHour: a, quietEndHour: b } = CFG;
    if (a == null || b == null || a === b) return false;
    return a < b ? (h >= a && h < b) : (h >= a || h < b);   // qua nửa đêm
}

const DAILY_AT = /^\d{1,2}:\d{2}$/.test(String(DR.at || "")) ? DR.at : "08:30";
const SHIPMENT_AT = /^\d{1,2}:\d{2}$/.test(String(SHIPMENT_CFG.at || "")) ? SHIPMENT_CFG.at : "";   // trống = không tự gửi tin vận đơn sáng
const SHIPMENT_EVENING_AT = /^\d{1,2}:\d{2}$/.test(String(SHIPMENT_CFG.toiAt || "")) ? SHIPMENT_CFG.toiAt : "";   // trống = không gửi tin tối
const formatHHMM = (ts) => new Date(ts).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CFG.timezone });
const INTRADAY_SLOTS = (DR.intradaySlots || []).map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x));
const slotLabel = (hhmm) => { const t = vnDateStr(); return `HÔM NAY ${t.slice(8, 10)}/${t.slice(5, 7)} · ${hhmm}`; };

// Mốc giữa ngày → kiểu tin: trước 16h là TRƯA, trước 20h là CHIỀU, còn lại TỐI.
const slotKind = (hhmm) => (toMin(hhmm) < 16 * 60 ? "trua" : toMin(hhmm) < 20 * 60 ? "chieu" : "toi");
// Khoá số đã báo của một mốc một nước (state.soMoc) — để mai cùng giờ so ▲▼.
const slotNumbersKey = (m, slotTime) => `${m}|${slotTime}`;

// Các mốc mỗi giờ của hôm nay: HH:<phut> từ `tu` tới `den`, bỏ giờ đã có bản tin thường.
function hourlySlots() {
    const minute = String(Number.isFinite(Number(HOURLY_CFG.phut)) ? Number(HOURLY_CFG.phut) : 5).padStart(2, "0");
    const reportHours = new Set(INTRADAY_SLOTS.map((x) => x.split(":")[0].padStart(2, "0")));
    const out = [];
    for (let h = Number(HOURLY_CFG.tu ?? 7); h <= Number(HOURLY_CFG.den ?? 23); h++) {
        const hh = String(h).padStart(2, "0");
        if (HOURLY_CFG.boGioCoBanTin !== false && reportHours.has(hh)) continue;
        out.push(`${hh}:${minute}`);
    }
    return out;
}

// Tin trợ giúp của nhóm một nước — lệnh /bot và tin giới thiệu khi bot mới vào nhóm.
const helpMessage = (m) => marketHelpMessage({
    nuoc: MARKETS[m], at: DAILY_AT, mocAds: INTRADAY_SLOTS.join(" · "), nguoi: MARKETER_LIST,
    moiGio: HOURLY_MARKETS.includes(m) ? hourlySlots() : null,
    vanDon: SHIPMENT_MARKETS.includes(m) ? { at: SHIPMENT_AT, toi: SHIPMENT_EVENING_AT, nguon: SHIPMENT_SOURCES[m] } : null,
});

module.exports = {
    ARGS, DRY, DR, SHIPMENT_CFG, CORRECTION_DEADLINE_HOURS, MARKETER_LIST, sleep, log, ddmm,
    MARKET_CODES, SHIPMENT_MARKETS, MESS_PANCAKE, HOURLY_CFG, HOURLY_MARKETS, argAfter,
    loadState, markState, vnDateStr, vnHHMM, inQuietHours,
    DAILY_AT, SHIPMENT_AT, SHIPMENT_EVENING_AT, formatHHMM, INTRADAY_SLOTS, slotLabel, slotKind, slotNumbersKey, hourlySlots,
    helpMessage,
};
