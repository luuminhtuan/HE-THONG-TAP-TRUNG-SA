// Khối chữ từng khách trong tin VẬN ĐƠN (tách từ shipment_alerts.js 16/11/2026): khối gọi, khối
// sắp nhận hàng, khối khách Đài ở cửa hàng, dòng mã gọn, @người phụ trách. Hàm thuần.
const { B, M } = require("./zalo_text");
const { fmt, truncate, failReason, orderLabel } = require("./shipment_common");
const {
    pickupCode, daysWaiting, twMessageLines, HOME_CARRIERS, homeDeliveryMessage, bilingualLines, upcomingDeliveryMessage,
} = require("./shipment_customer_messages");

const deadlineText = (a) => a.days_left == null ? "" : a.days_left <= 0 ? "HẾT HẠN HÔM NAY" : `còn ${a.days_left} ngày`;

/** "đã nhắn 2 lần" — sổ chưa có (khách từ trước khi có sổ) thì "đã nhắn lúc mới tới". */
const nudgedText = (times) => (times > 0 ? `đã nhắn ${times} lần` : "đã nhắn lúc mới tới");

/** Khối một khách phải GỌI: dòng đầu đậm, rồi khách, chỗ lấy, ghi chú, tin soạn sẵn.
 *  a.nhac = { lan } khi khách Đài đã được nhắn trước hôm nay (xem phanLoai). */
function callBlock(a, i, currency, homeDelivery, marketId = "") {
    const s = a.shipment || {};
    // "hẹn giao lại lần 3" — khách hẹn mãi là khách sắp bỏ đơn, gọi trước.
    const attemptSuffix = Number(s.fail_count) > 1 ? ` lần ${s.fail_count}` : "";
    const header = [orderLabel(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${currency}` : "",
        a.code === "giao_hong" ? failReason(s) + attemptSuffix : deadlineText(a),
        a.nhac ? (homeDelivery ? (a.nhac.lan > 0 ? `đã nhắn ${a.nhac.lan} lần` : "") : nudgedText(a.nhac.lan)) : ""].filter(Boolean).join(" · ");
    const lines = [B(`${i + 1}. ${header}`)];
    const customer = [s.customer, s.phone, homeDelivery ? s.city : ""].filter(Boolean).join(" · ");
    if (customer) lines.push(`👤 ${customer}`);
    if (!homeDelivery && s.store_name) lines.push(`🏪 ${s.store_name}${pickupCode(s) ? ` · mã lấy hàng ${pickupCode(s)}` : ""}`);
    // UAE, Việt Nam không có bảng đối tác — ghi chú là của đơn POS (thường là địa chỉ, hẹn ngày giao).
    if (s.note) lines.push(`📝 ${marketId === "AE" || marketId === "VN" ? "Ghi chú đơn" : "Đối tác ghi"}: "${truncate(s.note, 80)}"`);
    if (homeDelivery) {
        lines.push(...bilingualLines((lang) => homeDeliveryMessage(s, marketId, { nhacLai: !!a.nhac, lan: Number(s.fail_count) || null }, lang)));
    } else {
        lines.push(...twMessageLines(s, { ngay: daysWaiting(a), conLai: a.days_left, nhacLai: !!a.nhac }));
    }
    return lines.join("\n");
}

/** Khối một khách (Sing / UAE) SẮP NHẬN HÀNG: 3–4 dòng, câu báo trước kèm bản dịch. */
function upcomingBlock(x, currency, marketCode) {
    const s = x.shipment;
    const label = x.moc === "HomNay" ? "GIAO HÔM NAY" : x.moc === "NgayMai" ? "hẹn giao NGÀY MAI"
        : HOME_CARRIERS[marketCode] ? `đã vào ${HOME_CARRIERS[marketCode]}, sắp giao` : "đã vào kho hãng, sắp giao";
    const lines = [B([orderLabel(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${currency}` : "", label].filter(Boolean).join(" · "))];
    const customer = [s.customer, s.phone, s.city].filter(Boolean).join(" · ");
    if (customer) lines.push(`👤 ${customer}`);
    // Chỉ câu tiếng Anh: bản dịch đứng MỘT lần đầu mục cho mỗi loại (xem dichSapGiao) — câu
    // báo trước cùng loại giống hệt nhau, dịch từng khách làm tin UAE dài tới 11 phần.
    lines.push(`💬 ${upcomingDeliveryMessage(s, x.moc, marketCode, "en")}`);
    return lines.join("\n");
}

/** Bản dịch câu báo trước — một dòng cho mỗi loại có mặt trong mục. */
function upcomingTranslations(xs, marketCode) {
    if (marketCode === "VN") return [];   // câu gửi khách Việt Nam đã là tiếng Việt
    const stageNames = { HomNay: "giao hôm nay", NgayMai: "hẹn giao ngày mai", SapGiao: "sắp giao" };
    return ["HomNay", "NgayMai", "SapGiao"].filter((m) => xs.some((x) => x.moc === m)).map((m) => {
        const template = { customer: "{tên}", track17_code: "{mã}", status: (xs.find((x) => x.moc === m).shipment || {}).status };
        return `🇻🇳 Dịch (${stageNames[m]}): ${upcomingDeliveryMessage(template, m, marketCode, "vi")}`;
    });
}

/** Khối một khách Đài ở cửa hàng — MỚI TỚI (nhắn lần đầu) hoặc NHẮC LẠI (đã nhắn mà chưa
 *  lấy): gọn hơn khối gọi — 3 dòng. Nhắc lại thì dòng đầu ghi tới mấy ngày, đã nhắn mấy lần. */
function storeArrivalBlock(a, currency) {
    const s = a.shipment || {};
    const n = daysWaiting(a);
    const header = a.nhac
        ? [orderLabel(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${currency}` : "",
            n != null ? `tới ${n} ngày` : "", nudgedText(a.nhac.lan)]
        : [orderLabel(s), s.cod_local ? `${fmt(Math.round(s.cod_local))} ${currency}` : "", deadlineText(a)];
    const lines = [B(header.filter(Boolean).join(" · "))];
    const customer = [s.customer, s.phone].filter(Boolean).join(" · ");
    const pickupPlace = s.store_name ? `🏪 ${s.store_name}${pickupCode(s) ? ` · mã lấy hàng ${pickupCode(s)}` : ""}` : "";
    if (customer || pickupPlace) lines.push([customer ? `👤 ${customer}` : "", pickupPlace].filter(Boolean).join(" · "));
    lines.push(...twMessageLines(s, { ngay: n, conLai: a.days_left, nhacLai: !!a.nhac }));
    return lines.join("\n");
}

/** "T1 (1n) · T2 (3n) … +5" — danh sách mã gọn trên một dòng. */
function compactCodes(xs, label, max = 8) {
    const shown = xs.slice(0, max).map((a) => `${orderLabel(a.shipment)}${label ? ` ${label(a)}` : ""}`);
    return shown.join(" · ") + (xs.length > max ? ` … +${xs.length - max}` : "");
}

function ownerMention(opts) {
    const p = opts.phuTrach || {};
    return p.ten ? M(p.ten, p.uid) + " · " : "";
}

module.exports = { deadlineText, nudgedText, callBlock, upcomingBlock, upcomingTranslations, storeArrivalBlock, compactCodes, ownerMention };
