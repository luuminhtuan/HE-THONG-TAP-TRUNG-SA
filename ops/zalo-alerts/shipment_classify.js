// Chia đơn của tin VẬN ĐƠN vào từng mục (tách từ shipment_alerts.js 16/11/2026): gọi ngay, mới
// tới, nhắc lại, sắp giao, nên huỷ, hỏi đối tác, lệch — kèm SỔ NHẮC (khách nào đã được nhắn mấy
// lần). Hàm thuần.
const { addDays, toVnDate, failReason } = require("./shipment_common");
const { daysWaiting, deliveryStage } = require("./shipment_customer_messages");

// ─── Sổ nhắc: khách nào đã được nhắn, mấy lần ───────────────────────────────
// Sỹ Anh 30/09/2026: khách đã được nhắn mà 17TRACK vẫn thấy chưa lấy thì NHẮC LẠI mỗi sáng
// trong tin Zalo cho anh em nắm, kèm câu gửi khách gấp hơn. Bot ghi sổ mỗi sáng GỬI THẬT
// (state.json → vanDonNhac[nước][mã vận đơn] = { lan, dau, cuoi }).

/** Số NGÀY TRƯỚC HÔM NAY khách đã có trong tin sáng (tin hôm nay chưa tính). */
function priorNudges(nudgeLog, tracking, today) {
    const g = (nudgeLog || {})[tracking];
    if (!g) return 0;
    return Math.max(0, (Number(g.lan) || 0) - (g.cuoi === today ? 1 : 0));
}

/** Ghi sổ sau khi GỬI THẬT tin sáng: mỗi khách +1 lần (một lần mỗi ngày). Bỏ dòng không
 *  được nhắc 14 ngày — khách đã lấy / hàng đã hoàn thì không còn trong tin nữa. */
function recordNudges(nudgeLog, trackings, today) {
    const nudges = { ...(nudgeLog || {}) };
    for (const k of trackings || []) {
        const g = { lan: 0, dau: today, ...(nudges[k] || {}) };
        if (g.cuoi !== today) { g.lan = (Number(g.lan) || 0) + 1; g.cuoi = today; }
        nudges[k] = g;
    }
    const cutoff = addDays(today, -14);
    for (const k of Object.keys(nudges)) if (!nudges[k].cuoi || nudges[k].cuoi < cutoff) delete nudges[k];
    return nudges;
}

/** Từ chối nhận từ lần này trở đi thì thôi nhắn, đưa sang "nên huỷ" (Sỹ Anh chốt 02/10/2026). */
const REFUSAL_CANCEL_THRESHOLD = 3;
const shouldCancel = (a) => failReason((a || {}).shipment || {}) === "khách từ chối"
    && Number(((a || {}).shipment || {}).fail_count) >= REFUSAL_CANCEL_THRESHOLD;

/** Phân loại một khối đơn cho tin: gọi ngay, mới tới, nhắc lại, hỏi đối tác, lệch.
 *  soNhac: sổ nhắc của bot — khách Đài đã được nhắn trước hôm nay thì gắn a.nhac = { lan }. */
function classifyAlerts(d, today, homeDelivery, nudgeLog = {}, marketCode = "") {
    const alerts = d.alerts || [];
    const by = (code) => alerts.filter((a) => a.code === code);
    const returnAlerts = by("sap_bi_tra_ve");
    const dueSoon = returnAlerts.filter((a) => a.days_left == null || a.days_left >= 0)
        .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0));
    // Quá hạn: quá ÍT ngày nhất lên đầu — quá 1 ngày còn hỏi giữ được, quá 3 tuần thì thôi.
    const overdue = returnAlerts.filter((a) => a.days_left != null && a.days_left < 0).sort((a, b) => b.days_left - a.days_left);
    const failed = by("giao_hong");
    const incidents = failed.filter((a) => !["dang_hoan", "da_hoan"].includes(failReason(a.shipment || {})));
    const stalled = by("dung_im").filter((a) => (a.shipment || {}).track17_code);
    const notShipped = by("dung_im").filter((a) => !(a.shipment || {}).track17_code);
    const mismatched = by("lech_trang_thai");
    // Khách MỚI TỚI = hàng tới cửa hàng hôm qua hoặc hôm nay và CHƯA được nhắn ngày nào.
    // Hàng tới từ trước hôm qua thì hôm tới đã nằm trong mục mới tới (bot nhắn khách mới tới
    // từ 26/09) — coi là đã nhắn, kể cả khi sổ nhắc chưa ghi (sổ có từ 30/09).
    const yesterday = addDays(today, -1);
    const isNewArrival = (a) => [yesterday, today].includes(toVnDate((a.shipment || {}).status_since));
    const attachNudge = (a) => {
        if (homeDelivery) return a;
        const times = priorNudges(nudgeLog, (a.shipment || {}).tracking, today);
        return times > 0 || !isNewArrival(a) ? { ...a, nhac: { lan: times } } : a;
    };
    const arrived = by("toi_cua_hang").map(attachNudge);
    const newArrivals = arrived.filter((a) => !a.nhac && isNewArrival(a));
    // NHẮC LẠI (Sỹ Anh 30/09/2026): đã nhắn mà vẫn chưa lấy → lặp lại MỖI SÁNG tới khi lấy
    // hoặc sang mục gọi (còn ≤ 2 ngày). Nằm lâu nhất lên đầu.
    const reminders = homeDelivery ? [] : arrived.filter((a) => a.nhac)
        .sort((a, b) => (daysWaiting(b) ?? 0) - (daysWaiting(a) ?? 0));
    // Giao tận nhà: đơn giao hỏng / hẹn lại là đơn cứu được bằng một cuộc gọi → lên danh sách gọi.
    // Sing / UAE: khách đã nhắn ngày trước (sổ nhắc) hoặc đã hỏng ≥ 2 lần → câu nhắc lại, gấp hơn.
    const attachHomeNudge = (a) => {
        if (!homeDelivery) return a;
        const s = a.shipment || {};
        const times = priorNudges(nudgeLog, s.tracking, today);
        return times > 0 || Number(s.fail_count) >= 2 ? { ...a, nhac: { lan: times } } : a;
    };
    // NÊN HUỶ (Sỹ Anh chốt 02/10/2026): khách TỪ CHỐI nhận từ 3 lần trở lên — nhắn nữa cũng
    // không cứu được, chỉ làm tin dài (tin sáng UAE 02/10 dài 9 phần, phần lớn là khách từ
    // chối 4–5 lần). Rút khỏi danh sách gọi, không soạn câu gửi khách; gom MỘT dòng để huỷ đơn.
    const toCancel = !homeDelivery ? [] : incidents.filter(shouldCancel)
        .sort((a, b) => Number(b.shipment.fail_count) - Number(a.shipment.fail_count));
    const toCall = homeDelivery ? [...dueSoon, ...incidents.filter((a) => !shouldCancel(a))].map(attachHomeNudge) : dueSoon.map(attachNudge);
    // SẮP GIAO (Sing + UAE, Sỹ Anh 01/10/2026): báo trước khách mở máy, để ý điện thoại — mỗi
    // mốc một lần (xem mocSapGiao). Khoá sổ "<mốc>:<mã>" để không báo lại mỗi sáng.
    const stageOrder = { HomNay: 0, NgayMai: 1, SapGiao: 2 };
    const upcoming = !homeDelivery ? [] : (d.shipments || [])
        .map((s) => ({ shipment: s, moc: deliveryStage(s, today, marketCode) }))
        .filter((x) => x.moc)
        .map((x) => ({ ...x, khoa: `${x.moc}:${x.shipment.tracking}` }))
        .filter((x) => !priorNudges(nudgeLog, x.khoa, today))
        .sort((a, b) => stageOrder[a.moc] - stageOrder[b.moc]);
    return { sap: dueSoon, qua: overdue, suCo: incidents, dungIm: stalled, chuaGui: notShipped, lech: mismatched, moiToi: newArrivals, nhacLai: reminders, goi: toCall, sapGiao: upcoming, nenHuy: toCancel };
}

module.exports = { priorNudges, recordNudges, REFUSAL_CANCEL_THRESHOLD, shouldCancel, classifyAlerts };
