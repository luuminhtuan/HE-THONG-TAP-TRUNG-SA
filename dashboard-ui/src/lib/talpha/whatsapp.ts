/**
 * Link WhatsApp của khách (Sỹ Anh yêu cầu 29/09/2026) — Sổ đơn hàng và Theo dõi vận đơn.
 *
 * Số khách trong POS và bảng đối tác thường THIẾU mã nước: Đài "9xxxxxxxx", Singapore
 * "8xxxxxxx", UAE "5xxxxxxxx"; vài số có số 0 đầu, vài số đã có mã nước. wa.me cần số quốc
 * tế viết liền, không dấu "+": https://wa.me/886912345678.
 *
 * Luật từng nước khai ở talpha_rules.json → markets.*.phone. Số không khớp luật thì KHÔNG
 * dựng link — link sai là nhắn nhầm người lạ, tệ hơn không có link.
 *
 * Hàm thuần — để test được.
 */

export type PhoneRule = { cc: string; national_len: number; trunk?: string };

/** Một cụm chữ số → số quốc tế, hoặc null nếu không chắc. */
function toIntlNumber(digits: string, coPlus: boolean, r: PhoneRule): string | null {
    let d = digits;
    if (d.startsWith("00")) { d = d.slice(2); coPlus = true; }
    const trunk = r.trunk || "";
    // Đã có mã nước của chính nước này — kể cả kiểu ghi thừa số 0: +886 0912…
    if (d.startsWith(r.cc)) {
        const nationalPart = d.slice(r.cc.length);
        if (nationalPart.length === r.national_len) return d;
        if (trunk && nationalPart.startsWith(trunk) && nationalPart.length === trunk.length + r.national_len) {
            return r.cc + nationalPart.slice(trunk.length);
        }
    }
    // Ghi "+" rõ ràng mà không phải mã nước này: số nước khác (vd +63 của Philippines) — giữ
    // nguyên nếu độ dài hợp lệ theo chuẩn quốc tế (8–15 số).
    if (coPlus) return d.length >= 8 && d.length <= 15 ? d : null;
    if (trunk && d.startsWith(trunk) && d.length === trunk.length + r.national_len) d = d.slice(trunk.length);
    return d.length === r.national_len ? r.cc + d : null;
}

/** Số điện thoại thô → số quốc tế cho WhatsApp ("886912345678"), hoặc null. */
export function waNumber(raw: string | null | undefined, r: PhoneRule | null | undefined): string | null {
    if (!r) return null;
    const s = String(raw ?? "").trim();
    if (!s) return null;
    // Một ô có khi ghi hai số: "0912345678 / 0987654321" — lấy số hợp lệ đầu tiên.
    for (const part of s.split(/[/,;|]+/)) {
        const digits = part.replace(/\D/g, "");
        if (!digits) continue;
        const n = toIntlNumber(digits, /^\s*\+/.test(part), r);
        if (n) return n;
    }
    // Hai số dính liền không dấu ngăn (gặp thật: 20 chữ số "09…09…") → thử số đầu.
    const all = s.replace(/\D/g, "");
    const trunk = r.trunk || "";
    const fullLen = trunk.length + r.national_len;
    if (trunk && all.startsWith(trunk) && all.length >= 2 * fullLen) return toIntlNumber(all.slice(0, fullLen), false, r);
    return null;
}

/**
 * Link mở khung chat WhatsApp với khách, hoặc null nếu số không chắc. Có `text` thì khung chat
 * mở sẵn tin soạn sẵn — người gửi vẫn sửa được trước khi bấm gửi.
 */
export function waLink(raw: string | null | undefined, r: PhoneRule | null | undefined, text?: string | null): string | null {
    const n = waNumber(raw, r);
    if (!n) return null;
    return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`;
}

/**
 * Tin XÁC NHẬN ĐƠN gửi khách qua WhatsApp (Sỹ Anh 29/09/2026: "tao hay phải xác nhận lại với
 * khách"). Tiếng Anh — khách UAE phần lớn là lao động Philippines. Nhắc đủ thứ hay làm giao hỏng:
 * hàng gì, bao nhiêu tiền mặt phải trả, địa chỉ, giờ nhận. Thiếu ô nào thì bỏ dòng đó, không
 * viết "undefined".
 */
export function orderConfirmationMessage(o: {
    customer?: string | null; product?: string | null; quantity?: number | null;
    cod?: number | null; currency?: string | null; address?: string | null; tracking?: string | null;
}): string {
    const firstName = String(o.customer || "").trim().split(/\s+/)[0] || "there";
    const lines = [`Hi ${firstName}, thank you for your order! Please confirm the details:`];
    const item = String(o.product || "").trim();
    if (item) lines.push(`- Item: ${item}${o.quantity && o.quantity > 1 && !/×\d/.test(item) ? ` x${o.quantity}` : ""}`);
    if (o.cod && o.cod > 0) {
        const total = Math.round(o.cod * 100) / 100;
        lines.push(`- Total: ${total} ${o.currency || ""} (cash on delivery)`.replace(/\s+\(/, " ("));
    }
    const dc = String(o.address || "").replace(/\s+/g, " ").trim();
    if (dc) lines.push(`- Address: ${dc}`);
    if (o.tracking) lines.push(`- Parcel: ${o.tracking}`);
    lines.push("", "Please reply YES to confirm, and tell us a good time for delivery. Thank you!");
    return lines.join("\n");
}
