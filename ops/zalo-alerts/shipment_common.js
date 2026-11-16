// Phần dùng chung của tin VẬN ĐƠN (tách từ shipment_alerts.js 16/11/2026): định dạng số / ngày,
// dòng cảnh báo nguồn trạng thái (17TRACK / WeShip / bảng đối tác), lý do giao hỏng, sự kiện
// trong một ngày. Hàm thuần — không gọi mạng, không đụng Zalo.
const { B } = require("./zalo_text");

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const addDays = (date, n) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
function formatVnTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "?";
    const p = (o) => d.toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", ...o });
    return `${p({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ${p({ day: "2-digit" })}/${p({ month: "2-digit" })}`;
}
/** Ngày theo giờ Việt Nam của một mốc ISO — "hôm qua khách lấy" là theo ngày VN. */
function toVnDate(iso) {
    const t = Date.parse(iso || "");
    return Number.isNaN(t) ? null : new Date(t + 7 * 3600000).toISOString().slice(0, 10);
}
const truncate = (s, n) => { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
/** Tên nguồn trạng thái của nước này — "WeShip" (UAE), "POS (J&T)" (Việt Nam) hay "17TRACK". */
const sourceName = (d) => (d && d.provider === "weship" ? "WeShip" : d && d.provider === "pos" ? "POS (J&T)" : "17TRACK");

/** 17TRACK chạy được nhưng KHÔNG mã nào của nước này được theo dõi vì hãng bị từ chối đăng ký
 *  (Nhật 13/10/2026: Sagawa — "The carrier temporarily does not support registration"). Ghi
 *  "17TRACK ✓" lúc đó là nói dối: trạng thái thật vẫn chỉ theo bảng đối tác. */
const allRegistrationsRejected = (d) => d.provider !== "weship" && !!d.last_sync && Number(d.last_sync.register_rejected) > 0
    && !(d.shipments || []).some((s) => s.registered);

/**
 * Cảnh báo "số này mới tới đâu" — MỖI VẤN ĐỀ MỘT DÒNG, không có vấn đề thì không có dòng
 * nào. Số cũ mà không ai nói thì sale gọi nhầm khách đã lấy hàng rồi — nên tin TỰ TỐ khi
 * 17TRACK lỗi, hết quota, hay đồng bộ/nạp bảng đứng.
 */
function sourceStatusLines(d, nowTs, { quotaWarn = 200, staleHours = 26 } = {}) {
    const isStale = (iso) => iso && nowTs - Date.parse(iso) > staleHours * 3600000;
    const warnings = [];
    const ls = d.last_sync;
    const name = sourceName(d);
    // Việt Nam (11/11/2026): trạng thái J&T nằm sẵn trong đơn POS, talpha-sync nạp mỗi giờ —
    // không có lượt tra riêng, không quota. Sync đứng thì tin "sync-health" của bot đã kêu.
    if (d.provider === "pos") return "";
    if (d.has_api_key && !ls) {
        warnings.push(d.provider === "weship"
            ? `⚠️ ${B("WeShip chưa tra lần nào")} — chưa biết đơn nào giao hỏng`
            : `⚠️ ${B("17TRACK chưa đồng bộ lần nào")} — số theo bảng đối tác, trễ ~2 ngày`);
    }
    else if (ls && !ls.ok) warnings.push(`⚠️ ${B(`${name} lỗi ${formatVnTime(ls.at)}`)}: ${truncate(ls.error, 90)}`);
    else if (ls && isStale(ls.at)) warnings.push(`⚠️ ${B(`${name} chưa chạy từ ${formatVnTime(ls.at)}`)} — số có thể trễ`);
    // WeShip: lượt vẫn chạy khi vài mã lỗi — nhưng mã lỗi đứng im, phải nói.
    if (ls && ls.ok && Number(ls.failed) > 0) warnings.push(`⚠️ ${B(`WeShip lỗi ${fmt(ls.failed)} mã`)}: ${truncate(ls.error, 80)}`);
    // Nhiều khoá: một khoá chết thì lượt vẫn chạy bằng khoá khác — nhưng mã của khoá chết
    // đứng im, nên phải nêu đích danh.
    if (ls && ls.ok) {
        for (const k of (ls.keys || []).filter((x) => !x.ok)) warnings.push(`⚠️ ${B(`17TRACK ${k.label} lỗi`)}: ${truncate(k.error, 80)}`);
    }
    if (ls && Number(ls.orphaned) > 0) warnings.push(`⚠️ ${B(`${fmt(ls.orphaned)} mã thuộc khoá đã gỡ`)} — không cập nhật được nữa`);
    // Hết quota: nói rõ bao nhiêu đơn đang mù và làm gì, chứ không chỉ kêu "nạp thêm".
    if (ls && ls.quota_out) {
        // over_cap gồm cả đơn thường để lượt sau vì chia nhịp — đó KHÔNG phải đơn mù.
        const n = Math.max(0, (Number(ls.over_cap) || 0) - (Number(ls.deferred) || 0));
        warnings.push(`⚠️ ${B(`HẾT QUOTA 17TRACK${n ? ` — ${fmt(n)} đơn chưa được theo dõi` : ""}`)}: thêm khoá mới hoặc chờ ngày 1`);
    } else if (ls && ls.ok && ls.quota && ls.quota.total > 0) {
        // Ngưỡng theo cỡ gói: gói miễn phí vài trăm mã thì "còn dưới 200" là kêu mỗi ngày.
        const nguong = Math.min(quotaWarn, Math.ceil(ls.quota.total * 0.15));
        if (ls.quota.remain < nguong) warnings.push(`⚠️ ${B(`Quota 17TRACK sắp hết: còn ${fmt(ls.quota.remain)}/${fmt(ls.quota.total)}`)}`);
    }
    if (ls && ls.ok && allRegistrationsRejected(d)) {
        warnings.push(`⚠️ ${B(`17TRACK từ chối đăng ký ${fmt(ls.register_rejected)} mã`)} (hãng tạm chưa hỗ trợ qua API) — `
            + "trạng thái theo bảng đối tác, máy tự thử lại mỗi lượt");
    }
    if (isStale(d.last_import)) warnings.push(`⚠️ ${B(`Bảng đối tác chưa nạp từ ${formatVnTime(d.last_import)}`)}`);
    return warnings.join("\n");
}

/**
 * Lý do giao hỏng. 17TRACK nói bằng sub_status; đối tác nói bằng chữ trong cột trạng thái.
 * "hoàn" tách riêng: hàng đã quay đầu thì gọi khách không cứu được nữa — chỉ để đếm.
 */
function failReason(s) {
    const sub = String(s.sub_status || ""), raw = String(s.raw_status || s.last_event || "");
    if (/Returning/.test(sub) || (s.source !== "17track" && /hoàn/i.test(raw))) return "dang_hoan";
    if (/Returned/.test(sub)) return "da_hoan";
    if (s.source !== "17track" && /hẹn/i.test(raw)) return "khách hẹn giao lại";
    // J&T Việt Nam (qua POS, 11/11/2026): "Không liên lạc được Khách hàng/khóa máy".
    if (s.source === "pos" && /liên lạc|khóa máy|khoá máy|thuê bao|không nghe/i.test(raw)) return "không nghe máy";
    if (/Rejected/.test(sub) || /từ chối/i.test(raw)) return "khách từ chối";
    // Hai lý do riêng của WeShip (UAE).
    if (/NoResponse/.test(sub)) return "không nghe máy";
    if (/Rescheduled/.test(sub)) return "hẹn giao lại";
    if (/NoBody/.test(sub) || /vắng/i.test(raw)) return "vắng nhà";
    if (/InvalidAddress/.test(sub)) return "sai địa chỉ";
    if (s.status === "DeliveryFailure") return "giao hỏng";
    return "sự cố";
}
const isReturned = (s) => s.status === "Returned" || s.status === "Expired"
    || (s.status === "Exception" && /Return/.test(String(s.sub_status || "")))
    || ["dang_hoan", "da_hoan"].includes(failReason(s)) && (s.status === "Exception" || s.status === "DeliveryFailure");

// Mã đơn POS toàn số (UAE: "14") thêm "#" — "1. 14 · 119 AED" đọc lẫn với số thứ tự.
const orderLabel = (s) => { const x = String((s || {}).order_id || (s || {}).tracking || "?"); return /^\d+$/.test(x) ? `#${x}` : x; };

/**
 * Sự kiện trong MỘT ngày (giờ VN), đếm theo mốc đổi trạng thái: khách đã lấy / mới tới
 * cửa hàng / bắt đầu hoàn / đang đi giao — kèm tiền. Mốc 17TRACK là mốc thật; mốc từ bảng
 * đối tác là lúc nạp bảng thấy đổi (xấp xỉ, bảng trễ ~2 ngày).
 */
function dayEvents(shipments, date) {
    const result = { daLay: [], moiToi: [], hoan: [], dangGiao: [] };
    for (const s of shipments || []) {
        if (toVnDate(s.status_since) !== date) continue;
        if (s.status === "Delivered") result.daLay.push(s);
        else if (s.status === "AvailableForPickup") result.moiToi.push(s);
        else if (s.status === "OutForDelivery") result.dangGiao.push(s);
        else if (isReturned(s)) result.hoan.push(s);
    }
    return result;
}
const codTotal = (xs) => xs.reduce((n, s) => n + (Number(s.cod_local) || 0), 0);

module.exports = {
    fmt, ddmm, addDays, formatVnTime, toVnDate, truncate, sourceName,
    allRegistrationsRejected, sourceStatusLines, failReason, isReturned, orderLabel, dayEvents, codTotal,
};
