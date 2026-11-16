// "SỐ CHƯA ĐỦ" của tin ADS (tách từ daily_report.js 16/11/2026): tuổi số trong Sheet, TKQC / shop
// đọc lỗi, Sheet chưa có số hôm nay. Hàm thuần.
const { B, I } = require("./zalo_text");
const { isDayIncomplete } = require("./schedule");   // "ngày đó xong chưa" — có test riêng
const { ddmm } = require("./daily_report_common");

// Sheet KHÔNG BAO GIỜ mất dòng: sync chết thì dòng vẫn nằm đó, chỉ ĐỨNG SỐ. Nên "đọc
// được dòng ngày X" hoàn toàn không chứng minh số của ngày X đã đủ (04/09/2026: tin 8h
// báo 12,2tr / 116 đơn, số thật 37,2tr / 178 đơn — token Meta mất quyền từ chiều hôm
// trước). Từ đó tin tự tố tuổi của số nó đang đọc. Hai loại tin hỏi hai câu KHÁC NHAU:
//   - tin giữa ngày nói về HÔM NAY → chỉ hỏi được "số cũ bao lâu";
//   - tin 8h30 nói về NGÀY ĐÃ QUA → hỏi "đã có vòng sync nào chạy sau nửa đêm chưa".
function formatVnTime(ts) {
    const d = new Date(ts);
    const p = (o) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ngày `
        + `${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}
// Vì sao sync hỏng — tên TKQC / shop đọc lỗi (stale.loi = fetch_errors của /api/talpha/sync-health).
// 23/09/2026 tin chỉ nói "sync đứng 12 giờ 40 phút", không ai biết hai TKQC BM Thuyên bị Meta
// chặn quyền đọc tới khi mở log trên máy chủ. Có tên thì người đọc biết phải gọi ai.
function errorReason(error) {
    if (!error) return "";
    const failedAccounts = error.tkqc || [], shop = error.shops || [], lostAccess = new Set(error.mat_quyen || []);
    const sentences = [];
    if (failedAccounts.length) {
        sentences.push(`TKQC không đọc được: ${failedAccounts.join(", ")}`
            + (failedAccounts.every((t) => lostAccess.has(t)) ? " — Meta báo mất quyền đọc, cần cấp lại quyền trong Business Manager hoặc bỏ TK khỏi danh sách sync." : "."));
    }
    if (shop.length) sentences.push(`Shop POS không đọc được: ${shop.join(", ")}.`);
    return sentences.length ? `${I(sentences.join(" "))}\n` : "";
}

// TK đọc lỗi (chết, mất quyền, lỗi mạng): sync BỎ QUA nó, vẫn ghi Sheet bằng các TK còn lại
// (Sỹ Anh chốt 28/10/2026: "tkqc nào die thì kệ nó", sync/core/failed_accounts.py). Không phải "SỐ CHƯA
// ĐỦ" — chỉ nhắc tên để gỡ TK chết khỏi danh sách sync.
function skippedAccountsNote(stale) {
    const skippedAccounts = stale && stale.loi && stale.loi.bo_qua;
    if (!skippedAccounts || !skippedAccounts.length) return "";
    return `ℹ️ ${I(`TKQC không đọc được, đã bỏ qua: ${skippedAccounts.join(", ")}. `
        + "Báo cáo vẫn tính các TK còn lại (TK này giữ số đọc được lần cuối) — TK chết hẳn thì gỡ khỏi danh sách sync.")}`;
}

// Sheet tạo sẵn dòng cho MỌI ngày trong tháng, nên vòng ghi chưa chạy được lần nào từ 00:00
// thì dòng hôm nay toàn số 0. In "Ads 0đ · 0 đơn" là nói sai: 30/09/2026 tin 13:00 in đúng như
// vậy trong khi Meta đã tiêu 1,3tr. Chỉ kết luận "chưa có số" khi BIẾT vòng ghi OK gần nhất
// còn trước nửa đêm — không biết tuổi số thì in như cũ.
const dayStartTs = (d) => Date.parse(`${d}T00:00:00+07:00`);
function sheetMissingToday(T, opts, dateStr) {
    if (!opts.intraday || !opts.stale || opts.stale.lastOkTs == null) return false;
    if (["ads", "don", "mess", "doanh_so"].some((k) => Number(T[k] || 0) !== 0)) return false;
    return opts.stale.lastOkTs < dayStartTs(dateStr);
}

function buildStaleWarning(stale, dateStr, intraday) {
    if (!stale) return "";
    const reason = errorReason(stale.loi);
    if (intraday) {
        if (stale.okAge == null || !(stale.okAge > stale.limit)) return "";
        const h = Math.floor(stale.okAge / 60), m = Math.round(stale.okAge % 60);
        const stalledFor = h > 0 ? `${h} giờ${m ? " " + m + " phút" : ""}` : `${m} phút`;
        return `⚠️ ${B(`SỐ CHƯA ĐỦ — sync đứng ${stalledFor}.`)}\n${reason}${I("Đợi sync chạy lại rồi đọc lại.")}\n\n`;
    }
    if (!isDayIncomplete(stale.lastOkTs, dateStr)) return "";
    return `⚠️ ${B(`SỐ CHƯA ĐỦ — chưa có vòng sync nào chạy sau khi hết ngày ${ddmm(dateStr)}.`)}\n${reason}`
        + `${I(`Số dưới đây chốt lúc ${formatVnTime(stale.lastOkTs)} — chưa phải số cả ngày. Đợi sync chạy lại rồi đọc lại.`)}\n\n`;
}

// Cảnh báo "số chưa đủ" của MỘT tin. buildMarketerReports tính một lần rồi truyền xuống
// qua opts.canhBao: cờ chuaDu trả ra cho bot (để xếp lịch đính chính) và chữ in trong tin
// phải là CÙNG một kết quả — tính lại hai nơi là sớm muộn lệch nhau.
function resolveStaleWarning(opts, dateStr) {
    return opts.canhBao != null ? opts.canhBao : buildStaleWarning(opts.stale, dateStr, opts.intraday);
}

module.exports = { formatVnTime, errorReason, skippedAccountsNote, sheetMissingToday, buildStaleWarning, resolveStaleWarning };
