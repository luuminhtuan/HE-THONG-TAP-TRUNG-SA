import type { Shipment } from "./types";

/** Mã khách đọc cho nhân viên cửa hàng = mã TRACKING, không phải store_code (mã cửa
 *  hàng — sai tới 30/09/2026). Máy chủ tính sẵn pickup_code; thiếu thì tự tính y hệt. */
export const getPickupCode = (s: Shipment) =>
    String(s.pickup_code || s.track17_code || s.tracking || "").trim().replace(/^73N/i, "");

/** Tên cửa hàng cho người không đọc tiếng Trung: thêm chuỗi (7-ELEVEN / FamilyMart)
 *  theo kênh giao, trừ khi tên đã có sẵn ("全家新城康樂店"). */
export function storeDisplayName(s: Shipment): string {
    const name = String(s.store_name || "");
    const channel = String(s.ship_method || "");
    const chain = /7.?ELEVEN|7-11|711/i.test(channel) ? "7-ELEVEN" : /FAMILY|全家/i.test(channel) ? "FamilyMart" : "";
    return chain && !/全家|7-?11|ELEVEN|FAMILY/i.test(name) ? `${chain} ${name}` : name;
}

/**
 * Tin báo khách ra lấy hàng — TIẾNG ANH để gửi khách, kèm bản TIẾNG VIỆT cho sale đọc
 * hiểu. CÙNG CÂU CHỮ với bot Zalo (ops/zalo-alerts/shipment_alerts.js → tinKhachDai).
 *
 * Sale không phải tự gõ — gõ tay mỗi ngày vài chục tin là vừa chậm vừa sai tên cửa
 * hàng. Chỉ điền được khi có tên cửa hàng; thiếu thì trả null chứ KHÔNG soạn tin cụt,
 * vì tin thiếu chỗ lấy hàng thì khách đọc xong vẫn không biết đi đâu.
 *
 * Sỹ Anh chốt 30/09 → 01/10/2026:
 *  • tiếng Anh (khách Đài phần lớn là lao động Philippines/Indonesia/Việt), không nhắc
 *    chuẩn bị tiền;
 *  • lần đầu — nhẹ nhàng, nói hàng ĐÃ TỚI được mấy ngày (đếm xuôi), không nói còn
 *    mấy ngày (khách thấy còn nhiều ngày thì thong thả rồi quên);
 *  • nhắc lại — khách đã được nhắn mà chưa lấy: gấp hơn, mai/hôm nay là ngày cuối
 *    thì nói thẳng. Bot biết chắc ai đã nhắn (sổ nhắc); ở đây không có sổ nên dùng
 *    đúng luật dự phòng của bot: hàng nằm từ 2 ngày trở lên = đã nhắn lúc mới tới.
 */
export function buildPickupMessage(s: Shipment, timing: { ngay: number | null; conLai: number | null }, lang: "en" | "vi" = "en"): string | null {
    if (!s.store_name) return null;
    const vi = lang === "vi";
    const name = s.customer || (vi ? "bạn" : "there");
    const pickupCode = getPickupCode(s);
    const place = `${storeDisplayName(s)}${pickupCode ? (vi ? ` (mã lấy hàng ${pickupCode})` : ` (pickup code ${pickupCode})`) : ""}`;
    const { ngay: days, conLai: daysLeft } = timing;
    const isLastDay = daysLeft != null && daysLeft <= 0;
    const daysText = (n: number) => (vi ? `${n} ngày` : `${n} day${n === 1 ? "" : "s"}`);
    if (days != null && days >= 2) {
        if (vi) {
            const overdueText = `hàng của bạn đã nằm ở cửa hàng ${place} ${daysText(days)} rồi mà vẫn chưa được lấy!`;
            const deadlineText = isLastDay ? "Hôm nay là NGÀY CUỐI để lấy hàng — hôm nay không lấy là hàng bị trả về. Bạn nhớ ghé lấy ngay trong hôm nay nhé!"
                : daysLeft === 1 ? "Mai là ngày cuối để lấy hàng, quá hạn hàng sẽ bị trả về. Bạn ghé lấy sớm nhất có thể nhé!"
                    : "Cửa hàng chỉ giữ hàng thêm vài ngày nữa là trả về. Bạn ghé lấy sớm nhất có thể nhé!";
            return `Chào ${name}, nhắc bạn lần nữa: ${overdueText} ${deadlineText} Có gì thắc mắc bạn cứ nhắn lại cho shop nhé. Cảm ơn bạn!`;
        }
        const overdueText = `your parcel has been waiting at ${place} for ${daysText(days)} and hasn't been picked up yet!`;
        const deadlineText = isLastDay ? "Today is the LAST DAY to pick it up — if it's not collected today, it will be returned. Please make sure to pick it up today!"
            : daysLeft === 1 ? "Tomorrow is the last day to pick it up, after that it will be returned. Please pick it up as soon as possible!"
                : "The store will only keep it for a few more days before sending it back. Please pick it up as soon as possible!";
        return `Hi ${name}, this is another reminder: ${overdueText} ${deadlineText} If you have any questions, just reply to this message. Thank you!`;
    }
    if (vi) {
        const arrivedText = days ? `hàng của bạn đã tới cửa hàng ${place} được ${daysText(days)} rồi`
            : days === 0 ? `hàng của bạn đã tới cửa hàng ${place} hôm nay` : `hàng của bạn đã tới cửa hàng ${place}`;
        const deadlineText = isLastDay ? "Hôm nay là ngày cuối để lấy hàng, phiền bạn ghé cửa hàng lấy trong hôm nay nhé, không thì hàng sẽ bị trả về."
            : "Phiền bạn tranh thủ ghé cửa hàng lấy nhé, quá hạn hàng sẽ bị trả về.";
        return `Chào ${name}, ${arrivedText}. ${deadlineText} Cảm ơn bạn!`;
    }
    const arrivedText = days ? `your parcel arrived at ${place} ${daysText(days)} ago`
        : days === 0 ? `your parcel arrived at ${place} today` : `your parcel has arrived at ${place}`;
    const deadlineText = isLastDay ? "Today is the last day to pick it up, so please drop by the store today — otherwise it will be returned."
        : "Please drop by the store to pick it up when you can — if it's not picked up in time, it will be returned.";
    return `Hi ${name}, ${arrivedText}. ${deadlineText} Thank you!`;
}
