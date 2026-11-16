// Tin ĐÍNH CHÍNH của tin ADS (tách từ daily_report.js 16/11/2026). Hàm thuần.
const { B, I } = require("./zalo_text");
const { fmt } = require("./daily_report_common");
const { formatVnTime } = require("./daily_report_stale");

// ─── TIN ĐÍNH CHÍNH ───────────────────────────────────────────────────────────────
// Gửi sau một tin tạm (gửi đúng khung giờ trong lúc sync còn đứng). Chỉ nêu ĐÚNG chỗ lệch
// rồi đính kèm bản báo cáo đủ số — Sỹ Anh chốt 22/09/2026.
// Số không lệch chỗ nào thì CHỈ gửi mấy dòng đầu: lặp lại cả bản báo cáo y nguyên chỉ để
// nói "không đổi" là làm loãng nhóm.
const DIFF_FIELDS = [["ads", "Tiền ads", true], ["don", "Đơn", false],
    ["doanh_so", "Doanh số", true], ["mess", "Mess", false]];

function diffLines(oldNumbers, newNumbers) {
    const result = [];
    for (const [k, fieldLabel, isAmount] of DIFF_FIELDS) {
        const a = Math.round(Number((oldNumbers || {})[k] || 0)), b = Math.round(Number((newNumbers || {})[k] || 0));
        if (a === b) continue;
        const v = (x) => (isAmount ? fmt(x) + "đ" : fmt(x));
        result.push(`${fieldLabel}: ${v(a)} → ${B(v(b))}  (${b > a ? "+" : "−"}${v(Math.abs(b - a))})`);
    }
    return result;
}

function buildCorrectionMessage({ tin: originalMessage, soCu: oldNumbers, soMoi: newNumbers, label, luc: sentAt, intraday }) {
    const diffs = diffLines(oldNumbers, newNumbers);
    let m = `🔄 ${B(`ĐÍNH CHÍNH — ${label}`)}\n`;
    m += `${I(`Tin lúc ${formatVnTime(sentAt)} gửi khi sync còn đứng nên số chưa đủ. Vòng sync vừa chạy xong`
        + `${intraday ? " — số dưới đây đủ tới lúc này." : " — dưới đây là số cả ngày."}`)}\n`;
    if (!diffs.length) return m + `\n✅ ${B("Số không đổi")} — tin cũ đã đúng, không phải xem lại.`;
    return m + `\n${B("Lệch so với tin cũ:")}\n` + diffs.map((x) => "• " + x).join("\n") + `\n\n` + originalMessage;
}

module.exports = { diffLines, buildCorrectionMessage };
