// Phần dùng chung của tin ADS (tách từ daily_report.js 16/11/2026): định dạng số, chủ campaign,
// gọi realtime / sheet-report, lọc tab marketer của Sheet, ▲▼ so hôm qua. Chỉ khai hàm / hằng.
const { campaignOwner, MARKETERS, DISPLAY, UNASSIGN, MARKET_TABS, creditedCampaignOwner } = require("./rules");

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const p1 = (x) => Number(x || 0).toFixed(1).replace(".", ",");
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
// Tiền viết gọn cho dòng camp: 327k · 1,2tr — tin gộp phải vừa MỘT tin nên không xài số đầy đủ.
const compactMoney = (n) => {
    const x = Number(n || 0);
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}tr`;
    if (x >= 1_000) return `${Math.round(x / 1_000)}k`;
    return `${Math.round(x)}đ`;
};
// Tỷ lệ chốt = đơn / tin nhắn. Chỉ có nghĩa khi CẢ HAI cùng đến từ quảng cáo của người
// đó. Đơn gán theo tag POS nên người gần như không chạy ads vẫn nhận đơn → ra "chốt
// 460%", vô nghĩa và trông như lỗi. Trường hợp đó trả "—".
const closeRateText = (ord, mess) => (mess > 0 && ord <= mess ? p1(pct(ord, mess)) + "%" : "—");

// Tên hiển thị của người ĐÃ NGHỈ — không có tin riêng, không nằm trong bảng xếp hạng.
const FORMER_MARKETERS = new Set([...UNASSIGN].map((k) => DISPLAY[k] || k));
const UNASSIGNED_TAB = "(không gán)";

// Chủ campaign theo đúng luật của Sheet (xem chuCamp trong rules.js) — phần chi tiết phải
// cộng lại khớp số đầu bài của chính tin đó.
// camNuoc: tin của NHÓM MỘT NƯỚC — camp chạy lấn nước của team khác tính cho NGƯỜI CẦM nước đó
// (rules.chuTinhSo, Sỹ Anh chốt 10/10/2026), cùng luật vòng ghi Sheet. Tin gộp cũ giữ chủ camp gốc.
function marketerOf(name, creditMarketOwner = false) {
    const key = creditMarketOwner ? creditedCampaignOwner(name) : campaignOwner(name);
    return key ? DISPLAY[key] || key : "";
}

async function getJson(f, url, source) {
    const res = await f(url, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`${source} HTTP ${res.status}`);
    return res.json();
}

// 1 LẦN gọi realtime cho cả tin tổng lẫn tin cá nhân: route này hỏi thẳng Meta + POS live
// (chậm, có rate-limit) — gọi hai lần một mốc là tự chuốc lỗi.
function fetchRealtime(cfg, dateStr, f) {
    return getJson(f, `${cfg.realtimeUrl}?from_date=${dateStr}&to_date=${dateStr}`, "realtime");
}

async function fetchSheetReport(cfg, dateStr, f) {
    if (!cfg.sheetReportUrl) throw new Error("thiếu dailyReport.sheetReportUrl trong config");
    const j = await getJson(f, `${cfg.sheetReportUrl}?date=${dateStr}`, "sheet-report");
    if (j.error) throw new Error(j.error);
    if (!j.team) throw new Error(`Sheet chưa có dòng ngày ${dateStr}`);
    return j;
}

// Route trả MỌI tab khác "Tổng" trong mảng marketers — kể cả tab nước. Không lọc thì
// "Đài Loan" có tin riêng như một marketer và đứng Top 1 bảng xếp hạng (dính thật ngày
// 15/09/2026, lần đầu file có tab nước). Tin KHÔNG in số theo nước (Sỹ Anh chốt cùng
// ngày) nên tab nước bỏ lặng lẽ; tab không phải nước, không phải marketer đang khai
// trong rules, không phải "(không gán)" thì bỏ, có log.
function tabMarketer(sheet, log) {
    const marketers = [], unknownTabs = [];
    for (const r of sheet.marketers || []) {
        if (MARKET_TABS.has(r.tab)) continue;
        if (r.tab === UNASSIGNED_TAB || Object.prototype.hasOwnProperty.call(MARKETERS, r.tab)) marketers.push(r);
        else unknownTabs.push(r.tab);
    }
    if (unknownTabs.length && log) log(`Sheet có tab lạ, bỏ qua: ${unknownTabs.join(", ")}`);
    return marketers;
}

const dayBefore = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// ▲▼ so với hôm qua: tiền theo %, đếm (đơn, mess) theo số tuyệt đối.
function trendArrow(newValue, oldValue, isMoney) {
    if (oldValue == null) return "";
    if (isMoney) {
        if (!(oldValue > 0)) return "";
        const p = Math.round(((newValue - oldValue) / oldValue) * 100);
        return p === 0 ? " =" : ` ${p > 0 ? "▲" : "▼"}${Math.abs(p)}%`;
    }
    const d = Math.round(newValue - oldValue);
    return d === 0 ? " =" : ` ${d > 0 ? "▲" : "▼"}${Math.abs(d)}`;
}

module.exports = {
    fmt, pct, p1, ddmm, compactMoney, closeRateText, FORMER_MARKETERS, UNASSIGNED_TAB, marketerOf,
    getJson, fetchRealtime, fetchSheetReport, tabMarketer, dayBefore, trendArrow,
};
