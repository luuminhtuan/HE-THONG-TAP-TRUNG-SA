// Câu SOẠN SẴN gửi khách trong tin VẬN ĐƠN (tách từ shipment_alerts.js 16/11/2026): Đài nhận ở
// cửa hàng tiện lợi; Singapore (J&T), Nhật (Japan Post), UAE (WeShip) giao tận nhà; câu báo trước
// khi giao. Tiếng Anh gửi khách + bản dịch tiếng Việt cho anh em. Hàm thuần.
const { addDays, toVnDate } = require("./shipment_common");

// ─── Tin nhắn soạn sẵn gửi khách ─────────────────────────────────────────────
// Cùng câu chữ với nút "Chép tin" trên dashboard (tracking-tab.tsx → soanTin): khách Đài
// lấy hàng ở cửa hàng tiện lợi, nên tin phải có TÊN CỬA HÀNG + MÃ LẤY HÀNG — thiếu cửa
// hàng thì không soạn (tin cụt, khách đọc xong vẫn không biết đi đâu).

/** Mã khách đọc cho nhân viên cửa hàng = MÃ TRACKING, không phải store_code (mã cửa hàng
 *  7-11 #265155 — sai tới 30/09/2026). API đã tính sẵn pickup_code; bản cũ thì tự tính:
 *  mã đã sửa cho 17TRACK, bỏ tiền tố 73N chỉ 17TRACK cần. */
const pickupCode = (s) => String(s.pickup_code || s.track17_code || s.tracking || "").trim().replace(/^73N/i, "");

/** Hàng đã nằm ở cửa hàng mấy ngày — API tính sẵn (daysWaiting) vào a.days. */
const daysWaiting = (a) => {
    const n = Number((a || {}).days);
    return (a || {}).days == null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n));
};

/** Tên cửa hàng cho người không đọc tiếng Trung: thêm chuỗi (7-ELEVEN / FamilyMart) theo
 *  kênh giao, trừ khi tên đã có sẵn ("全家新城康樂店"). */
function storeDisplayName(s) {
    const name = String(s.store_name || "");
    const channel = String(s.ship_method || "");
    const chain = /7.?ELEVEN|7-11|711/i.test(channel) ? "7-ELEVEN" : /FAMILY|全家/i.test(channel) ? "FamilyMart" : "";
    return chain && !/全家|7-?11|ELEVEN|FAMILY/i.test(name) ? `${chain} ${name}` : name;
}

/**
 * Tin báo khách Đài ra lấy hàng — TIẾNG ANH để gửi khách, kèm bản TIẾNG VIỆT cho anh em
 * đọc hiểu (Sỹ Anh chốt 01/10/2026: khách Đài phần lớn là lao động Philippines/Indonesia/
 * Việt đọc tiếng Anh; không nhắc chuẩn bị tiền nữa).
 *
 * • LẦN ĐẦU — nhẹ nhàng, nói hàng ĐÃ TỚI được mấy ngày (đếm xuôi) chứ không nói còn mấy
 *   ngày: ghi "còn 5 ngày" thì khách thong thả rồi quên.
 * • NHẮC LẠI — khách đã được nhắn mà vẫn chưa lấy: gấp hơn, nói rõ nằm đó mấy ngày rồi mà
 *   chưa lấy, sắp bị trả; mai / hôm nay là ngày cuối thì nói thẳng.
 * Luôn có mã lấy hàng (mã tracking). Hạn thật hiện cho Thương ở dòng đầu khối.
 * Câu chữ PHẢI giống tracking-tab.tsx → soanTin.
 *
 * @param han  { ngay: số ngày đã nằm ở cửa hàng, conLai: còn mấy ngày (≤0 = hôm nay là
 *             ngày cuối), nhacLai: khách đã được nhắn trước hôm nay }
 * @param lang "en" (gửi khách) · "vi" (bản dịch cho anh em)
 */
function twCustomerMessage(s, { ngay: daysAtStore = null, conLai: daysLeft = null, nhacLai: isReminder = false } = {}, lang = "en") {
    if (!s.store_name) return null;
    const isVi = lang === "vi";
    const name = s.customer || (isVi ? "bạn" : "there");
    const pickup = pickupCode(s);
    const pickupPlace = `${storeDisplayName(s)}${pickup ? (isVi ? ` (mã lấy hàng ${pickup})` : ` (pickup code ${pickup})`) : ""}`;
    const isLastDay = daysLeft != null && daysLeft <= 0;
    const formatDays = (n) => (isVi ? `${n} ngày` : `${n} day${n === 1 ? "" : "s"}`);
    if (isReminder) {
        if (isVi) {
            const waitText = `hàng của bạn đã nằm ở cửa hàng ${pickupPlace} ${daysAtStore ? formatDays(daysAtStore) : "mấy ngày"} rồi mà vẫn chưa được lấy!`;
            const deadlineNote = isLastDay ? "Hôm nay là NGÀY CUỐI để lấy hàng — hôm nay không lấy là hàng bị trả về. Bạn nhớ ghé lấy ngay trong hôm nay nhé!"
                : daysLeft === 1 ? "Mai là ngày cuối để lấy hàng, quá hạn hàng sẽ bị trả về. Bạn ghé lấy sớm nhất có thể nhé!"
                    : "Cửa hàng chỉ giữ hàng thêm vài ngày nữa là trả về. Bạn ghé lấy sớm nhất có thể nhé!";
            return `Chào ${name}, nhắc bạn lần nữa: ${waitText} ${deadlineNote} Có gì thắc mắc bạn cứ nhắn lại cho shop nhé. Cảm ơn bạn!`;
        }
        const waitText = `your parcel has been waiting at ${pickupPlace} for ${daysAtStore ? formatDays(daysAtStore) : "several days"} and hasn't been picked up yet!`;
        const deadlineNote = isLastDay ? "Today is the LAST DAY to pick it up — if it's not collected today, it will be returned. Please make sure to pick it up today!"
            : daysLeft === 1 ? "Tomorrow is the last day to pick it up, after that it will be returned. Please pick it up as soon as possible!"
                : "The store will only keep it for a few more days before sending it back. Please pick it up as soon as possible!";
        return `Hi ${name}, this is another reminder: ${waitText} ${deadlineNote} If you have any questions, just reply to this message. Thank you!`;
    }
    if (isVi) {
        const arrivalText = daysAtStore ? `hàng của bạn đã tới cửa hàng ${pickupPlace} được ${formatDays(daysAtStore)} rồi`
            : daysAtStore === 0 ? `hàng của bạn đã tới cửa hàng ${pickupPlace} hôm nay` : `hàng của bạn đã tới cửa hàng ${pickupPlace}`;
        const deadlineNote = isLastDay ? "Hôm nay là ngày cuối để lấy hàng, phiền bạn ghé cửa hàng lấy trong hôm nay nhé, không thì hàng sẽ bị trả về."
            : "Phiền bạn tranh thủ ghé cửa hàng lấy nhé, quá hạn hàng sẽ bị trả về.";
        return `Chào ${name}, ${arrivalText}. ${deadlineNote} Cảm ơn bạn!`;
    }
    const arrivalText = daysAtStore ? `your parcel arrived at ${pickupPlace} ${formatDays(daysAtStore)} ago`
        : daysAtStore === 0 ? `your parcel arrived at ${pickupPlace} today` : `your parcel has arrived at ${pickupPlace}`;
    const deadlineNote = isLastDay ? "Today is the last day to pick it up, so please drop by the store today — otherwise it will be returned."
        : "Please drop by the store to pick it up when you can — if it's not picked up in time, it will be returned.";
    return `Hi ${name}, ${arrivalText}. ${deadlineNote} Thank you!`;
}

/** Hai dòng trong tin Zalo: câu tiếng Anh để chép gửi khách, rồi bản dịch cho anh em. */
function twMessageLines(s, waitInfo) {
    const en = twCustomerMessage(s, waitInfo, "en");
    if (!en) return [];
    return [`💬 ${en}`, `🇻🇳 Dịch: ${twCustomerMessage(s, waitInfo, "vi")}`];
}

// Hãng giao tận nhà của nước đọc bảng đối tác + 17TRACK — tên hãng nói với khách.
const HOME_CARRIERS = { SG: "J&T", JP: "Japan Post" };

// ─── Singapore giao tận nhà (J&T) — Sỹ Anh chốt 01/10/2026 ───────────────────
// Tiếng Anh gửi khách + bản dịch tiếng Việt cho anh em, như Đài.
//   TH1 — SẮP GIAO: 17TRACK thấy hàng đã vào tay J&T (InTransit) → báo trước khách mở máy,
//         để ý điện thoại; J&T đi giao (OutForDelivery) → báo "hôm nay giao".
//   TH2 — GIAO KHÔNG ĐƯỢC: bảo khách xem cuộc gọi nhỡ / tin nhắn của shipper J&T rồi CHỦ
//         ĐỘNG liên hệ lại hẹn giờ. Đã nhắn mà vẫn chưa giao được (hoặc hỏng ≥ 2 lần) → gấp hơn.

/** TH2 — J&T giao không được. han = { nhacLai, lan: số lần giao hỏng nếu biết }. */
function sgCustomerMessage(s, { nhacLai: isReminder = false, lan: times = null } = {}, lang = "en") {
    const isVi = lang === "vi";
    const name = s.customer || (isVi ? "bạn" : "there");
    const trackingCode = s.track17_code || s.tracking;
    if (isReminder) {
        if (isVi) {
            const waitText = times >= 2 ? `J&T đã giao hàng (${trackingCode}) ${times} lần mà vẫn không gặp được bạn!` : `J&T vẫn chưa giao được hàng (${trackingCode}) cho bạn!`;
            return `Chào ${name}, shop nhắc bạn lần nữa: ${waitText} Bạn kiểm tra điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn của shipper J&T không, `
                + "rồi liên hệ lại với họ ngay hôm nay để hẹn giờ giao nhé — không giao được sớm thì hàng sẽ bị trả về. Cảm ơn bạn!";
        }
        const waitText = times >= 2 ? `J&T has tried to deliver your parcel (${trackingCode}) ${times} times and still couldn't reach you!` : `J&T still hasn't been able to deliver your parcel (${trackingCode})!`;
        return `Hi ${name}, this is another reminder: ${waitText} Please check your phone for missed calls or SMS from the J&T driver `
            + "and contact them today to arrange the delivery — if it can't be delivered soon, the parcel will be returned. Thank you!";
    }
    if (isVi) {
        return `Chào ${name}, J&T đã tới giao hàng (${trackingCode}) nhưng không gặp được bạn. Bạn kiểm tra lại điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn `
            + "của shipper J&T không, rồi chủ động liên hệ lại với họ để hẹn giờ giao nhé. Cần shop hỗ trợ thì bạn cứ nhắn lại. Cảm ơn bạn!";
    }
    return `Hi ${name}, J&T tried to deliver your parcel (${trackingCode}) but couldn't reach you. Please check your phone for any missed calls or SMS `
        + "from the J&T driver and contact them directly to arrange a new delivery time. If you need help, just reply to us. Thank you!";
}

// ─── Nhật Bản giao tận nhà — Sỹ Anh yêu cầu 13/10/2026; hãng là JAPAN POST từ 21/10/2026 ──
// (13/10 khai Sagawa nhưng 17TRACK từ chối mọi mã; 21/10 bên lên đơn báo hàng đi Japan Post.)
// Khách là người Philippines ở Nhật (camp JAPAN/…/PHI/…) → tiếng Anh như Đài, Sing. Bưu điện
// giao không gặp thì để PHIẾU BÁO VẮNG NHÀ (不在連絡票) trong hộp thư; khách hẹn giao lại
// (再配達) bằng số điện thoại / mã QR trên phiếu. Bưu điện chỉ giữ hàng khoảng 1 tuần rồi trả về.
function jpCustomerMessage(s, { nhacLai: isReminder = false, lan: times = null } = {}, lang = "en") {
    const isVi = lang === "vi";
    const H = HOME_CARRIERS.JP;
    const name = s.customer || (isVi ? "bạn" : "there");
    const trackingCode = s.track17_code || s.tracking;
    if (isReminder) {
        if (isVi) {
            const waitText = times >= 2 ? `${H} đã giao hàng (${trackingCode}) ${times} lần mà vẫn không gặp được bạn!` : `${H} vẫn chưa giao được hàng (${trackingCode}) cho bạn!`;
            return `Chào ${name}, shop nhắc bạn lần nữa: ${waitText} Bạn xem hộp thư có phiếu báo vắng nhà của ${H} (不在連絡票) không, `
                + `rồi gọi số trên phiếu hoặc quét mã QR để hẹn giao lại ngay hôm nay nhé — ${H} chỉ giữ hàng khoảng 1 tuần, quá hạn hàng sẽ bị trả về. `
                + "Không thấy phiếu thì bạn nhắn shop giờ nhận hàng tiện cho bạn. Cảm ơn bạn!";
        }
        const waitText = times >= 2 ? `${H} has tried to deliver your parcel (${trackingCode}) ${times} times and still couldn't reach you!` : `${H} still hasn't been able to deliver your parcel (${trackingCode})!`;
        return `Hi ${name}, this is another reminder: ${waitText} Please check your mailbox for the ${H} missed-delivery notice (不在連絡票) `
            + `and call the number or scan the QR code on it to request redelivery today — ${H} only keeps the parcel for about a week before returning it. `
            + "If you can't find the notice, just reply with a good time for delivery. Thank you!";
    }
    if (isVi) {
        return `Chào ${name}, ${H} đã tới giao hàng (${trackingCode}) nhưng bạn không có nhà. Bạn xem hộp thư có phiếu báo vắng nhà (不在連絡票) không, `
            + "rồi gọi số trên phiếu hoặc quét mã QR để hẹn ngày giờ giao lại nhé. Không thấy phiếu thì bạn nhắn shop giờ nhận hàng tiện cho bạn. Cảm ơn bạn!";
    }
    return `Hi ${name}, ${H} tried to deliver your parcel (${trackingCode}) but you weren't home. Please check your mailbox for the missed-delivery notice (不在連絡票) `
        + "and call the number or scan the QR code on it to choose a new delivery time. If you can't find it, just reply with a good time and we'll arrange it. Thank you!";
}

/**
 * TH1 — mốc BÁO TRƯỚC khi giao (Sing + Nhật + UAE). null = không báo.
 *   "HomNay"  — đi giao / hẹn giao đúng HÔM NAY (sự kiện hôm nay, không lấy sự kiện hôm qua:
 *               tin 08:30 VN là 05:30 UAE, trước giờ tài xế xuất phát);
 *   "NgayMai" — WeShip "DELIVERY SCHEDULED ON NEXT DAY" (đúng kiểu báo trước 1 ngày);
 *   "SapGiao" — đã vào kho hãng / đi giao từ hôm qua mà chưa xong.
 * Sự kiện cũ quá 2 ngày thì thôi — đơn đứng im đã có mục hỏi đối tác. Sing, Nhật chỉ tin 17TRACK:
 * "đang vận chuyển" của bảng đối tác có thể còn ở chặng Trung Quốc / chặng gửi từ Đài sang.
 */
function deliveryStage(s, today, marketCode) {
    const date = toVnDate(s.last_event_time || s.status_since);
    if (!date || date < addDays(today, -2)) return null;
    if (s.status === "OutForDelivery") return date === today ? "HomNay" : "SapGiao";
    if (s.status !== "InTransit") return null;
    if (HOME_CARRIERS[marketCode] && s.source !== "17track") return null;
    if (/Scheduled/.test(String(s.sub_status || "")) || /SCHEDULED\s*ON\s*NEXT\s*DAY/i.test(String(s.raw_status || ""))) {
        const deliveryDate = addDays(date, 1);
        return deliveryDate === today ? "HomNay" : deliveryDate > today ? "NgayMai" : "SapGiao";
    }
    return "SapGiao";
}

/** TH1 — câu báo trước. Sing nói "J&T", Nhật nói "Japan Post", UAE nói "the courier" và "order (parcel …)". */
function upcomingDeliveryMessage(s, stage, marketCode, lang = "en") {
    const isVi = lang === "vi";
    const name = s.customer || (isVi ? "bạn" : "there");
    const trackingCode = s.track17_code || s.tracking;
    const carrierName = HOME_CARRIERS[marketCode];
    const hasCarrier = !!carrierName;
    if (isVi) {
        const carrier = hasCarrier ? carrierName : "bên giao hàng";
        const driver = hasCarrier ? `shipper ${carrierName}` : "tài xế giao hàng";
        const parcelRef = hasCarrier ? `hàng của bạn (${trackingCode})` : `đơn của bạn (mã ${trackingCode})`;
        const sentence = stage === "HomNay" ? `${parcelRef} sẽ được ${carrier} giao trong hôm nay!`
            : stage === "NgayMai" ? `${parcelRef} đã được hẹn giao vào ngày mai!`
                : `${parcelRef} đã tới ${carrier} và sắp được giao (thường trong 1–2 ngày).`;
        return `Chào ${name}, ${sentence} Bạn nhớ mở máy và để ý cuộc gọi, tin nhắn của ${driver} để không lỡ nhận hàng nhé. Cảm ơn bạn!`;
    }
    const carrier = hasCarrier ? carrierName : "the courier";
    const driver = hasCarrier ? `the ${carrierName} driver` : "the delivery driver";
    const parcelRef = hasCarrier ? `your parcel (${trackingCode})` : `your order (parcel ${trackingCode})`;
    const contactKinds = hasCarrier ? "calls or SMS" : "calls or messages";
    const sentence = stage === "HomNay" ? (s.status === "OutForDelivery" ? `${parcelRef} is out for delivery with ${carrier} today!` : `${parcelRef} is scheduled for delivery today!`)
        : stage === "NgayMai" ? `${parcelRef} is scheduled for delivery tomorrow!`
            : `${parcelRef} is now with ${carrier} and will be delivered soon (usually within 1–2 days).`;
    return `Hi ${name}, ${sentence} Please keep your phone on and watch for ${contactKinds} from ${driver} so you don't miss the delivery. Thank you!`;
}

// UAE giao tận nhà qua WeShip — câu theo LÝ DO (Sỹ Anh duyệt 01/10/2026): khách từ chối thì hỏi
// có vấn đề gì, còn lấy không; không nghe máy / hẹn lại thì bảo xem cuộc gọi nhỡ, chủ động gọi
// lại tài xế; sai địa chỉ thì xin địa chỉ đủ hoặc định vị. Nhắc lại thì gấp hơn.
function aeCustomerMessage(s, { nhacLai: isReminder = false, lan: times = null } = {}, lang = "en") {
    const isVi = lang === "vi";
    const name = s.customer || (isVi ? "bạn" : "there");
    const trackingCode = s.track17_code || s.tracking;
    const sub = String(s.sub_status || "");
    if (/Rejected/.test(sub)) {
        if (isReminder) return isVi
            ? `Chào ${name}, shop chưa nhận được phản hồi của bạn về đơn (mã ${trackingCode}) bị từ chối nhận hôm trước. Bạn còn muốn nhận hàng không? Bạn trả lời shop trong hôm nay nhé, không thì đơn sẽ bị huỷ và hoàn về. Cảm ơn bạn!`
            : `Hi ${name}, we haven't heard back from you about your order (parcel ${trackingCode}), which was refused at delivery. Do you still want it? Please reply today — otherwise the order will be cancelled and returned. Thank you!`;
        return isVi
            ? `Chào ${name}, bên giao hàng báo đơn của bạn (mã ${trackingCode}) bị từ chối nhận. Đơn hàng có vấn đề gì không bạn? Nếu bạn vẫn muốn nhận, nhắn lại giờ tiện để shop giao lại nhé. Cảm ơn bạn!`
            : `Hi ${name}, the courier told us your order (parcel ${trackingCode}) was refused at delivery. Was there a problem with the order? If you still want it, just reply with a good time and we'll deliver it again. Thank you!`;
    }
    const badAddress = /InvalidAddress/.test(sub);
    if (isReminder) {
        if (isVi) {
            const waitText = times >= 2 ? `bên giao hàng đã giao đơn của bạn (mã ${trackingCode}) ${times} lần mà vẫn chưa giao được!` : `bên giao hàng vẫn chưa giao được đơn của bạn (mã ${trackingCode})!`;
            const action = badAddress ? "Bạn gửi shop địa chỉ đầy đủ hoặc định vị ngay hôm nay nhé"
                : "Bạn kiểm tra cuộc gọi nhỡ, tin nhắn của tài xế rồi liên hệ lại ngay hôm nay, hoặc nhắn shop giờ nhận hàng nhé";
            return `Chào ${name}, shop nhắc bạn lần nữa: ${waitText} ${action} — không giao được sớm thì hàng sẽ bị trả về. Cảm ơn bạn!`;
        }
        const waitText = times >= 2 ? `the courier has tried to deliver your order (parcel ${trackingCode}) ${times} times and still couldn't complete it!` : `the courier still hasn't been able to deliver your order (parcel ${trackingCode})!`;
        const action = badAddress ? "Please reply today with your full address or location pin"
            : "Please check your phone for missed calls or messages from the delivery driver and contact them today, or reply to us with a good time";
        return `Hi ${name}, this is another reminder: ${waitText} ${action} — if it can't be delivered soon, it will be returned. Thank you!`;
    }
    if (badAddress) return isVi
        ? `Chào ${name}, bên giao hàng không tìm được địa chỉ của bạn cho đơn (mã ${trackingCode}). Bạn nhắn lại giúp shop địa chỉ đầy đủ (toà nhà, số phòng, khu vực) hoặc gửi định vị, kèm giờ nhận hàng tiện cho bạn nhé. Cảm ơn bạn!`
        : `Hi ${name}, the courier couldn't find your address for your order (parcel ${trackingCode}). Please reply with your full address (building, flat number, area) or send your location pin, plus a good time for delivery. Thank you!`;
    if (/NoResponse/.test(sub)) return isVi
        ? `Chào ${name}, bên giao hàng đã đi giao đơn của bạn (mã ${trackingCode}) nhưng gọi không được. Bạn kiểm tra lại điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn của tài xế không, rồi chủ động gọi lại để hẹn giờ giao, hoặc nhắn shop giờ nhận hàng tiện cho bạn nhé. Nhớ mở máy giúp shop. Cảm ơn bạn!`
        : `Hi ${name}, the courier tried to deliver your order (parcel ${trackingCode}) but couldn't reach you by phone. Please check your phone for missed calls or messages from the delivery driver and call them back to arrange a delivery time, or reply to us with a good time. Please keep your phone on. Thank you!`;
    return isVi
        ? `Chào ${name}, đơn của bạn (mã ${trackingCode}) đã được hẹn giao lại. Bạn kiểm tra điện thoại xem có cuộc gọi nhỡ hoặc tin nhắn của tài xế không, rồi liên hệ lại để chốt giờ giao, hoặc nhắn shop giờ nhận hàng tiện cho bạn nhé. Nhớ mở máy giúp shop. Cảm ơn bạn!`
        : `Hi ${name}, the delivery of your order (parcel ${trackingCode}) has been rescheduled. Please check your phone for missed calls or messages from the delivery driver and contact them to confirm a delivery time, or reply to us with a good time. Please keep your phone on. Thank you!`;
}
const homeDeliveryMessage = (s, marketId, waitInfo, lang) => (marketId === "AE" ? aeCustomerMessage(s, waitInfo, lang)
    : marketId === "JP" ? jpCustomerMessage(s, waitInfo, lang) : sgCustomerMessage(s, waitInfo, lang));
/** Hai dòng: câu tiếng Anh gửi khách + bản dịch tiếng Việt cho anh em. */
const bilingualLines = (f) => { const en = f("en"); return en ? [`💬 ${en}`, `🇻🇳 Dịch: ${f("vi")}`] : []; };

module.exports = {
    pickupCode, daysWaiting, storeDisplayName, twCustomerMessage, twMessageLines,
    HOME_CARRIERS, sgCustomerMessage, jpCustomerMessage, aeCustomerMessage, homeDeliveryMessage, bilingualLines,
    deliveryStage, upcomingDeliveryMessage,
};
