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
const { B, I, M } = require("./zalo_text");

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
/** Tên nguồn trạng thái của nước này — "WeShip" (UAE) hay "17TRACK". */
const sourceName = (d) => (d && d.provider === "weship" ? "WeShip" : "17TRACK");

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
    // UAE không có bảng đối tác — ghi chú là của đơn POS (thường là địa chỉ, hẹn ngày giao).
    if (s.note) lines.push(`📝 ${marketId === "AE" ? "Ghi chú đơn" : "Đối tác ghi"}: "${truncate(s.note, 80)}"`);
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

function ownerMention(opts) {
    const p = opts.phuTrach || {};
    return p.ten ? M(p.ten, p.uid) + " · " : "";
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
