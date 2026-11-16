// Tin VẬN ĐƠN — Sỹ Anh duyệt mẫu 26/09/2026 (trang "Bản tin Zalo 08:30 · 22:00", bản 3):
//   • 08:30 SÁNG: hôm qua ra sao + khách phải gọi/nhắn hôm nay, mỗi khách ĐỦ tên, SĐT, cửa
//     hàng, mã lấy hàng, hạn và TIN NHẮN SOẠN SẴN (Đài tiếng Trung, Singapore tiếng Anh) để
//     chép gửi luôn — đọc tin là làm, không mở dashboard, không cần lệnh.
//   • 22:00 TỐI: hôm nay làm được gì — khách phải gọi sáng nay đã lấy chưa, cứu được bao
//     nhiêu tiền, khách nào còn treo sang mai; và số cả ngày.
// Mỗi thị trường một nhóm (VẬN ĐƠN TW, VẬN ĐƠN SGP, VẬN ĐƠN UAE; từ 08/10/2026 nhóm "ADS + VẬN ĐƠN <nước>", có cả Nhật). Việc giao cho người phụ trách
// (@Thương). UAE (28/09/2026) không qua 17TRACK: trạng thái tra thẳng trang WeShip — tin ghi
// "WeShip" ở chỗ Đài/Singapore ghi "17TRACK" (d.provider).
//
// Số lấy từ ĐÚNG route màn "Theo dõi vận đơn" (/api/talpha/tracking?market=…), nên tin và
// màn hình không lệch được: cùng luật cảnh báo buildAlerts, cùng mốc hạn lấy hàng.
// Hàm thuần: không gọi mạng (trừ fetchVanDon), không đụng Zalo — để test được.
//
// Tách 16/11/2026 (file này chỉ còn lấy số + dựng tin sáng / tối; module.exports giữ nguyên):
//   shipment_common.js            — định dạng, cảnh báo nguồn, lý do giao hỏng, sự kiện trong ngày
//   shipment_customer_messages.js — câu soạn sẵn gửi khách từng nước
//   shipment_classify.js          — chia đơn vào từng mục + sổ nhắc
//   shipment_blocks.js            — khối chữ từng khách
const { B, I } = require("./zalo_text");
const {
    fmt, ddmm, addDays, formatVnTime, truncate, sourceName,
    allRegistrationsRejected, sourceStatusLines, failReason, isReturned, orderLabel, dayEvents, codTotal,
} = require("./shipment_common");
const {
    pickupCode, twCustomerMessage, sgCustomerMessage, jpCustomerMessage, aeCustomerMessage, upcomingDeliveryMessage, deliveryStage,
} = require("./shipment_customer_messages");
const { priorNudges, recordNudges, REFUSAL_CANCEL_THRESHOLD, classifyAlerts } = require("./shipment_classify");
const {
    callBlock, upcomingBlock, upcomingTranslations, storeArrivalBlock, compactCodes, ownerMention,
} = require("./shipment_blocks");

async function fetchShipments(cfg, today, f = fetch, market = "") {
    if (!cfg || !cfg.url) throw new Error("thiếu vanDon.url trong config");
    const from = addDays(today, -(Number(cfg.rangeDays) || 60));
    const marketQuery = market ? `&market=${encodeURIComponent(market)}` : "";
    const res = await f(`${cfg.url}?from=${from}&to=${today}${marketQuery}`, { headers: { "cache-control": "no-store" } });
    if (!res.ok) throw new Error(`tracking HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
}

/**
 * TIN SÁNG (08:30) — cũng dùng cho /vandon gõ trong ngày (opts.tieuDe khác).
 * @param d     JSON của GET /api/talpha/tracking?market=…
 * @param opts  { today, nowTs, maxGoi, maxMoiToi, quotaWarn, phuTrach:{ten,uid}, tieuDe }
 * @returns     { text, goi: [khoá vận đơn], moiToi: [khoá] } — bot lưu hai danh sách này để
 *              tin 22:00 chấm "sáng nay phải gọi ai, tối đã lấy chưa".
 */
function buildShipmentMorning(d, opts = {}) {
    const today = opts.today;
    const nowTs = opts.nowTs ?? Date.now();
    const maxToCall = Number(opts.maxGoi) || 15;
    const maxNewArrivals = Number(opts.maxMoiToi) || 20;
    const maxReminders = Number(opts.maxNhacLai) || 20;
    const marketInfo = d.market || {};
    const currency = marketInfo.currency || "NT$";
    const homeDelivery = !!marketInfo.code && marketInfo.code !== "TW";
    const marketLabel = String(marketInfo.label || "Đài Loan").toUpperCase();
    const yesterday = addDays(today, -1);
    const { qua: overdue, suCo: incidents, dungIm: stalled, chuaGui: notShipped, lech: mismatched, moiToi: newArrivals, nhacLai: reminders, goi: toCall, sapGiao: upcoming, nenHuy: toCancel } = classifyAlerts(d, today, homeDelivery, opts.soNhac, marketInfo.code);
    const maxUpcoming = Number(opts.maxSapGiao) || 20;
    const yesterdayEvents = dayEvents(d.shipments, yesterday);
    const counts = d.counts || {};
    const ls = d.last_sync;

    const lines = [B(opts.tieuDe || `☀️ VẬN ĐƠN ${marketLabel} · SÁNG ${ddmm(today)}`)];
    const sourceParts = [];
    if (!d.has_api_key || allRegistrationsRejected(d)) sourceParts.push("theo bảng đối tác, trễ ~2 ngày");
    else if (ls && ls.ok) sourceParts.push(`${sourceName(d)} ${formatVnTime(ls.at).slice(0, 5)} ✓` + (ls.quota ? ` · quota còn ${fmt(ls.quota.remain)}/${fmt(ls.quota.total)}` : ""));
    if (sourceParts.length) lines.push(I(sourceParts.join(" · ")));
    const sourceWarning = sourceStatusLines(d, nowTs, opts);
    if (sourceWarning) lines.push(sourceWarning);

    lines.push("", B(`📊 HÔM QUA ${ddmm(yesterday)}`));
    if (homeDelivery) {
        lines.push(`✅ Giao thành công ${B(`${fmt(yesterdayEvents.daLay.length)} đơn · ${fmt(Math.round(codTotal(yesterdayEvents.daLay)))} ${currency}`)}`);
        if (yesterdayEvents.hoan.length) lines.push(`↩️ Bắt đầu hoàn ${fmt(yesterdayEvents.hoan.length)} · ${fmt(Math.round(codTotal(yesterdayEvents.hoan)))} ${currency}`);
        lines.push(`🚚 Đang đi giao ${fmt(counts.OutForDelivery || 0)} đơn · 📦 Đang trên đường ${fmt((counts.InTransit || 0) + (counts.InfoReceived || 0))} đơn`);
    } else {
        lines.push(`✅ Khách đã lấy ${B(`${fmt(yesterdayEvents.daLay.length)} đơn · ${fmt(Math.round(codTotal(yesterdayEvents.daLay)))} ${currency}`)}`);
        lines.push(`🏪 Mới tới cửa hàng ${fmt(yesterdayEvents.moiToi.length)} · ↩️ Bắt đầu hoàn ${fmt(yesterdayEvents.hoan.length)} · ${fmt(Math.round(codTotal(yesterdayEvents.hoan)))} ${currency}`);
        lines.push(`📦 Đang nằm cửa hàng ${fmt(counts.AvailableForPickup || 0)} đơn · ${fmt(Math.round((d.totals || {}).at_store_value || 0))} ${currency}`);
    }

    if (toCall.length) {
        const action = homeDelivery ? "GIAO HỎNG / HẸN LẠI" : "SẮP BỊ TRẢ VỀ";
        lines.push("", `☎️ ${ownerMention(opts)}${B(`GỌI ${fmt(toCall.length)} KHÁCH ${action}`)}`);
        toCall.slice(0, maxToCall).forEach((a, i) => lines.push("", callBlock(a, i, currency, homeDelivery, marketInfo.code)));
        if (toCall.length > maxToCall) lines.push("", I(`… ${fmt(toCall.length - maxToCall)} khách nữa trên dashboard`));
    } else {
        lines.push("", `☎️ ${B("Không có khách nào phải gọi gấp hôm nay")} ✅`);
    }

    if (toCancel.length) {
        lines.push("", `🗑️ ${B(`NÊN HUỶ ${fmt(toCancel.length)} ĐƠN`)} · ${fmt(Math.round(codTotal(toCancel.map((a) => a.shipment))))} ${currency}`
            + ` — khách từ chối nhận từ ${REFUSAL_CANCEL_THRESHOLD} lần trở lên, không nhắn nữa`,
            compactCodes(toCancel, (a) => `(${a.shipment.fail_count} lần)`, 12));
    }

    if (upcoming.length) {
        lines.push("", `🚚 ${ownerMention(opts)}${B(`BÁO TRƯỚC ${fmt(upcoming.length)} KHÁCH SẮP NHẬN HÀNG`)} — nhắn khách mở máy, để ý điện thoại`,
            ...upcomingTranslations(upcoming.slice(0, maxUpcoming), marketInfo.code));
        upcoming.slice(0, maxUpcoming).forEach((x) => lines.push("", upcomingBlock(x, currency, marketInfo.code)));
        if (upcoming.length > maxUpcoming) lines.push("", I(`… ${fmt(upcoming.length - maxUpcoming)} khách nữa trên dashboard`));
    }

    if (!homeDelivery && newArrivals.length) {
        lines.push("", `📬 ${ownerMention(opts)}${B(`NHẮN ${fmt(newArrivals.length)} KHÁCH HÀNG MỚI TỚI`)}`);
        newArrivals.slice(0, maxNewArrivals).forEach((a) => lines.push("", storeArrivalBlock(a, currency)));
        if (newArrivals.length > maxNewArrivals) lines.push("", I(`… ${fmt(newArrivals.length - maxNewArrivals)} khách nữa trên dashboard`));
    }

    if (reminders.length) {
        lines.push("", `🔁 ${ownerMention(opts)}${B(`NHẮC LẠI ${fmt(reminders.length)} KHÁCH ĐÃ NHẮN MÀ CHƯA LẤY`)}`);
        reminders.slice(0, maxReminders).forEach((a) => lines.push("", storeArrivalBlock(a, currency)));
        if (reminders.length > maxReminders) lines.push("", I(`… ${fmt(reminders.length - maxReminders)} khách nữa trên dashboard`));
    }

    const questions = [];
    if (overdue.length) questions.push(`• ${fmt(overdue.length)} đơn quá hạn còn giữ không: ${compactCodes(overdue, (a) => `(${-a.days_left}n)`)}`);
    if (!homeDelivery && incidents.length) questions.push(`• ${fmt(incidents.length)} đơn giao hỏng/sự cố: ${compactCodes(incidents, (a) => `(${failReason(a.shipment || {})})`)}`);
    if (stalled.length) questions.push(`• ${fmt(stalled.length)} đơn không nhúc nhích: ${compactCodes(stalled, (a) => `(${a.days}n)`)}`);
    if (notShipped.length) questions.push(`• ${fmt(notShipped.length)} đơn chưa gửi hàng: ${compactCodes(notShipped, (a) => `(${a.days}n)`)}`);
    if (questions.length) lines.push("", B("🔎 HỎI ĐỐI TÁC"), ...questions);

    if (mismatched.length) {
        lines.push("", B(`💰 KIỂM ${fmt(mismatched.length)} ĐƠN LỆCH trước đối soát COD`));
        for (const a of mismatched.slice(0, 8)) lines.push(`• ${orderLabel(a.shipment)}: ${truncate(String(a.detail || "").split(" — ")[0], 90)}`);
        if (mismatched.length > 8) lines.push(I(`… +${mismatched.length - 8} đơn`));
    }

    const trackingsOf = (xs) => xs.map((a) => (a.shipment || {}).tracking).filter(Boolean);
    // Khách Đài có câu soạn sẵn trong tin này (đủ cửa hàng) — bot ghi sổ nhắc sau khi gửi thật.
    const withStore = (xs) => xs.filter((a) => (a.shipment || {}).store_name);
    return {
        text: lines.join("\n"),
        goi: trackingsOf(toCall),
        moiToi: trackingsOf(newArrivals),
        nhacLai: trackingsOf(reminders),
        daNhan: homeDelivery
            // Sing / UAE: khách giao hỏng có câu soạn sẵn + mốc báo trước đã gửi (khoá "<mốc>:<mã>").
            ? [...trackingsOf(toCall.slice(0, maxToCall)), ...upcoming.slice(0, maxUpcoming).map((x) => x.khoa)]
            : trackingsOf([...withStore(toCall.slice(0, maxToCall)), ...withStore(newArrivals.slice(0, maxNewArrivals)), ...withStore(reminders.slice(0, maxReminders))]),
        sapGiao: upcoming.map((x) => (x.shipment || {}).tracking).filter(Boolean),
    };
}

/**
 * TIN TỐI (22:00) — hôm nay làm được gì. 17TRACK cập nhật lại lúc 21:30 (miễn phí).
 * @param sangNay  { goi: [khoá], moiToi: [khoá] } bot lưu lúc gửi tin sáng; không có (bot vừa
 *                 bật lại, hôm nay chưa gửi tin sáng) thì bỏ phần chấm, vẫn báo số cả ngày.
 */
function buildShipmentEvening(d, opts = {}) {
    const today = opts.today;
    const nowTs = opts.nowTs ?? Date.now();
    const marketInfo = d.market || {};
    const currency = marketInfo.currency || "NT$";
    const homeDelivery = !!marketInfo.code && marketInfo.code !== "TW";
    const marketLabel = String(marketInfo.label || "Đài Loan").toUpperCase();
    const ls = d.last_sync;
    const byKey = new Map((d.shipments || []).map((s) => [s.tracking, s]));
    const daysLeftByTracking = new Map((d.alerts || []).filter((a) => a.days_left != null).map((a) => [(a.shipment || {}).tracking, a.days_left]));

    const lines = [B(`🌙 VẬN ĐƠN ${marketLabel} · TỐI ${ddmm(today)} · HÔM NAY LÀM ĐƯỢC GÌ`)];
    if (ls && ls.ok) lines.push(I(`${sourceName(d)} cập nhật ${formatVnTime(ls.at).slice(0, 5)} ✓`));
    const sourceWarning = sourceStatusLines(d, nowTs, opts);
    if (sourceWarning) lines.push(sourceWarning);

    // Chấm danh sách buổi sáng: khách đã lấy / chưa / bị trả về, theo trạng thái lúc này.
    const grade = (keys) => {
        const result = { lay: [], cho: [], tra: [] };
        for (const k of keys || []) {
            const s = byKey.get(k);
            if (!s) continue;
            if (s.status === "Delivered") result.lay.push(s);
            else if (isReturned(s) || s.status === "Returned" || s.status === "Cancelled" || s.status === "Destroyed") result.tra.push(s);
            else result.cho.push(s);
        }
        return result;
    };
    const morning = opts.sangNay;
    if (morning && (morning.goi || []).length) {
        const g = grade(morning.goi);
        const action = homeDelivery ? "GIAO HỎNG / HẸN LẠI" : "PHẢI GỌI";
        lines.push("", B(`☎️ ${fmt(morning.goi.length)} KHÁCH ${action} SÁNG NAY`));
        lines.push(`✅ ${fmt(g.lay.length)} đã ${homeDelivery ? "giao" : "lấy"}${g.lay.length ? ` · ${B(`cứu ${fmt(Math.round(codTotal(g.lay)))} ${currency}`)}` : ""}`);
        if (g.cho.length) {
            const expiringTomorrow = g.cho.filter((s) => (daysLeftByTracking.get(s.tracking) ?? 99) <= 1);
            const suffix = !homeDelivery && expiringTomorrow.length ? `, ${B("MAI HẾT HẠN")}` : "";
            lines.push(`⏳ ${fmt(g.cho.length)} chưa ${homeDelivery ? "giao" : "lấy"}${suffix}: ${g.cho.slice(0, 10).map(orderLabel).join(" · ")}${g.cho.length > 10 ? " …" : ""}`);
        }
        if (g.tra.length) lines.push(`❌ ${fmt(g.tra.length)} bị trả về: ${g.tra.slice(0, 10).map(orderLabel).join(" · ")} · ${fmt(Math.round(codTotal(g.tra)))} ${currency}`);
    }
    if (!homeDelivery && morning && (morning.moiToi || []).length) {
        const m = grade(morning.moiToi);
        lines.push("", `📬 ${B(`${fmt(morning.moiToi.length)} KHÁCH HÀNG MỚI TỚI`)} → ${fmt(m.lay.length)} đã lấy · ${fmt(m.cho.length)} còn chờ`);
    }
    if (morning && (morning.sapGiao || []).length) {
        const m = grade(morning.sapGiao);
        lines.push("", `🚚 ${B(`${fmt(morning.sapGiao.length)} KHÁCH BÁO TRƯỚC SÁNG NAY`)} → ${fmt(m.lay.length)} đã nhận`
            + `${m.lay.length ? ` (${fmt(Math.round(codTotal(m.lay)))} ${currency})` : ""} · ${fmt(m.cho.length)} chưa`
            + `${m.tra.length ? ` · ${fmt(m.tra.length)} bị trả về` : ""}`);
    }
    if (!homeDelivery && morning && (morning.nhacLai || []).length) {
        const m = grade(morning.nhacLai);
        lines.push("", `🔁 ${B(`${fmt(morning.nhacLai.length)} KHÁCH NHẮC LẠI`)} → ${fmt(m.lay.length)} đã lấy`
            + `${m.lay.length ? ` (${fmt(Math.round(codTotal(m.lay)))} ${currency})` : ""} · ${fmt(m.cho.length)} còn chờ, sáng mai nhắc tiếp`);
    }

    const todayEvents = dayEvents(d.shipments, today);
    const counts = d.counts || {};
    lines.push("", B(`📊 CẢ NGÀY ${ddmm(today)}`));
    if (homeDelivery) {
        lines.push(`✅ Giao thành công ${fmt(todayEvents.daLay.length)} đơn · ${fmt(Math.round(codTotal(todayEvents.daLay)))} ${currency}`);
        if (todayEvents.hoan.length) lines.push(`↩️ Bắt đầu hoàn ${fmt(todayEvents.hoan.length)} · ${fmt(Math.round(codTotal(todayEvents.hoan)))} ${currency}`);
        lines.push(`🚚 Đang đi giao ${fmt(counts.OutForDelivery || 0)} · 📦 Đang trên đường ${fmt((counts.InTransit || 0) + (counts.InfoReceived || 0))}`);
    } else {
        lines.push(`✅ Khách đã lấy ${fmt(todayEvents.daLay.length)} đơn · ${fmt(Math.round(codTotal(todayEvents.daLay)))} ${currency}`);
        lines.push(`🏪 Mới tới cửa hàng ${fmt(todayEvents.moiToi.length)} · ↩️ Bắt đầu hoàn ${fmt(todayEvents.hoan.length)} · ${fmt(Math.round(codTotal(todayEvents.hoan)))} ${currency}`);
        lines.push(`📦 Còn nằm cửa hàng ${fmt(counts.AvailableForPickup || 0)} đơn · ${fmt(Math.round((d.totals || {}).at_store_value || 0))} ${currency}`);
    }
    if (morning && (morning.goi || []).length) {
        const pendingCount = grade(morning.goi).cho.length;
        if (pendingCount) lines.push("", I(`Sáng mai 08:30: ${fmt(pendingCount)} khách còn treo ở trên đứng đầu danh sách gọi.`));
    }
    return lines.join("\n");
}

module.exports = { buildShipmentMorning, buildShipmentEvening, fetchShipments, sourceStatusLines, recordNudges, priorNudges, failReason, pickupCode, dayEvents, twCustomerMessage, sgCustomerMessage, jpCustomerMessage, aeCustomerMessage, upcomingDeliveryMessage, deliveryStage };
