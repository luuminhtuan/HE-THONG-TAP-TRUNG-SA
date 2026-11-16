// Lệnh gõ trong nhóm Zalo. Sỹ Anh chốt 15/09/2026: tự động CHỈ gửi mốc 8h30, còn lại
// gửi "khi có ai đó yêu cầu". Hàm thuần — chữ người gõ → việc bot phải làm — không đụng
// mạng, không đụng Zalo, để test được.
//
//   /baocao               số ĐANG CHẠY hôm nay, gộp trong MỘT tin
//   /baocao homqua        số hôm qua          /baocao 14/09   số ngày đó
//   /baocao Lộc           chi tiết campaign của một người (ghép ngày: /baocao homqua Lộc)
//   /baocao team          chỉ số TỔNG TEAM, không kèm campaign
//   /canhbao              camp đốt tiền 0 tin nhắn + chi tiêu bất thường, ngay lúc gõ
//   /vandon               vận đơn cần xử lý của nước của nhóm (nhóm "ADS + VẬN ĐƠN <nước>", 08/10/2026)
//   /vandon sg · tw · uae · jp   (dòng lệnh) chọn nước
//   /gio                  tin mỗi giờ (ads + tin nhắn Pancake + đơn theo page) ngay lúc gõ — nước có moiGio
//   /bot                  cách dùng
// Có dấu hay không dấu, hoa hay thường đều được. Không bắt đầu bằng "/" → không phải lệnh,
// bot im — tin báo cáo của chính bot cũng đi qua đây nên điều này là bắt buộc.
const { B, I } = require("./zalo_text");
const { RULES } = require("./rules");

const stripAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const compact = (s) => stripAccents(s).replace(/[\s.]/g, "");

// Tên nước gõ sau /vandon → mã shop (TW, SG…). Sinh từ talpha_rules.json: mã shop, khoá nước, tên
// hiển thị và mọi cách viết ở market_aliases (04/11/2026) — thêm nước ở config là lệnh nhận ngay.
const MARKET_BY_NAME = (() => {
    const mk = RULES.markets || {};
    const shopCode = (v) => (v && typeof v === "object" && v.shop_label ? String(v.shop_label).toUpperCase() : null);
    const out = {};
    for (const [key, v] of Object.entries(mk)) {
        if (shopCode(v)) for (const name of [v.shop_label, key, v.display]) if (name) out[compact(name)] = shopCode(v);
    }
    for (const [name, key] of Object.entries(RULES.market_aliases || {})) {
        if (!name.startsWith("_") && shopCode(mk[key])) out[compact(name)] = shopCode(mk[key]);
    }
    return out;
})();

const COMMAND_ALIASES = {
    baocao: "baocao", bc: "baocao",
    canhbao: "canhbao", cb: "canhbao",
    vandon: "vandon", vd: "vandon",
    gio: "gio",
    bot: "trogiup", lenh: "trogiup", help: "trogiup",
};

function dayBefore(today) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * @param text   chữ người gõ
 * @param today  "YYYY-MM-DD" giờ VN
 * @param nguoi  [{ key: "Loc", ten: "Lộc" }, …] — marketer đang khai trong rules
 * @returns null (không phải lệnh) · { lenh: "canhbao" | "trogiup" }
 *        · { lenh: "baocao", ngay, homNay, loc: null | "team" | tên hiển thị } · { loi }
 */
function parseCommand(text, { today, nguoi: marketers = [] }) {
    const s = String(text || "").trim();
    if (!s.startsWith("/")) return null;
    const [head, ...rest] = s.split(/\s+/);
    const command = COMMAND_ALIASES[stripAccents(head.slice(1))];
    if (!command) return null;
    if (command === "vandon") {
        const market = compact(rest.join(" "));
        if (!market) return { lenh: command };
        if (MARKET_BY_NAME[market]) return { lenh: command, nuoc: MARKET_BY_NAME[market] };
        // Mang theo lenh "vandon" để lỗi được trả lời ở nhóm VẬN ĐƠN (lỗi trơn bị bỏ ở đó).
        return { lenh: command, loi: `Không hiểu "${rest.join(" ")}". Gõ /vandon (vận đơn của nước của nhóm này).` };
    }
    if (command !== "baocao") return { lenh: command };

    const original = rest.join(" ");
    let remainder = ` ${stripAccents(original)} `;
    let date = today;
    if (/\bhom\s*qua\b/.test(remainder)) {
        date = dayBefore(today);
        remainder = remainder.replace(/\bhom\s*qua\b/, " ");
    } else if (/\bhom\s*nay\b/.test(remainder)) {
        remainder = remainder.replace(/\bhom\s*nay\b/, " ");
    }
    const d = remainder.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
    if (d) {
        const iso = `${d[3] || today.slice(0, 4)}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
        const parsedDate = new Date(iso + "T00:00:00Z");
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== iso) {
            return { loi: `Ngày "${d[0]}" không có thật. Viết kiểu /baocao 14/09.` };
        }
        if (iso > today) return { loi: `Ngày ${d[0]} chưa tới — chưa có số.` };
        date = iso;
        remainder = remainder.replace(d[0], " ");
    }

    const scopeText = remainder.replace(/\s+/g, " ").trim();
    let scope = null;
    if (scopeText) {
        if (["team", "tong", "tongteam"].includes(compact(scopeText))) scope = "team";
        else {
            const match = marketers.find((n) => compact(n.ten) === compact(scopeText) || compact(n.key) === compact(scopeText));
            if (!match) return { loi: `Không hiểu "${original}". Gõ /bot xem cách dùng.` };
            scope = match.ten;
        }
    }
    return { lenh: command, ngay: date, homNay: date === today, loc: scope };
}

function adsHelpMessage({ at, toi: eveningAt, nguoi: marketers = [] } = {}) {
    const example = marketers[0] ? marketers[0].ten : "Lộc";
    return `🤖 ${B("Bot TALPHA — báo cáo ads")}\n`
        + `Tự gửi ${at || "08:30"} (kết quả hôm qua)${eveningAt ? ` và ${eveningAt} (kết quả hôm nay)` : ""}: số tổng, theo nước, xếp hạng và chi tiết từng camp.\n\n`
        + `${B("Gõ trong nhóm để lấy số:")}\n`
        + `• /baocao — số đang chạy hôm nay (1 tin)\n`
        + `• /baocao homqua — số hôm qua\n`
        + `• /baocao 14/09 — số một ngày\n`
        + `• /baocao ${example} — chi tiết campaign của một người (ghép được: /baocao homqua ${example})\n`
        + `• /baocao team — chỉ số TỔNG TEAM\n`
        + `• /canhbao — camp đốt tiền không ra tin nhắn, chi tiêu bất thường\n`
        + `${I("Có dấu hay không dấu đều được.")}`;
}

function shipmentHelpMessage({ at, toi: eveningAt, nuoc: market, nguon: source } = {}) {
    return `📦 ${B(`Bot TALPHA — vận đơn${market ? ` ${market}` : ""}`)}\n`
        + `Tự gửi ${at || "08:30"}: hôm qua ra sao + khách phải gọi, nhắn hôm nay (đủ tên, SĐT, chỗ lấy hàng, tin nhắn soạn sẵn).\n`
        + (eveningAt ? `Tự gửi ${eveningAt}: hôm nay làm được gì — khách đã lấy chưa, khách còn treo sang mai.\n` : "")
        + `Trạng thái lấy từ ${source || "bảng đối tác + 17TRACK"} (cập nhật 6h và 21:30).\n\n`
        + `${B("Gõ trong nhóm:")}\n`
        + `• /vandon — danh sách mới nhất ngay lúc gõ\n`
        + `• /bot — cách dùng\n`
        + `${I("Có dấu hay không dấu đều được.")}`;
}

/**
 * Tin hướng dẫn của nhóm "ADS + VẬN ĐƠN <nước>" (08/10/2026) — gửi MỘT lần khi bot gặp nhóm mới.
 * @param o { nuoc: {ten, flag, sapChay}, at, mocAds, vanDon: {at, toi, nguon} | null, nguoi }
 */
function marketHelpMessage({ nuoc: market, at, mocAds: adsSlots, vanDon: shipmentCfg, nguoi: marketers = [], moiGio: hourlySlots = null } = {}) {
    const example = marketers[0] ? marketers[0].ten : "Lộc";
    const marketTitle = market ? `${market.flag} ${market.ten}` : "";
    const lines = [
        `🤖 ${B(`Bot TALPHA — ADS + VẬN ĐƠN ${marketTitle}`)}`,
        `Nhóm này chỉ nhận số của ${marketTitle} (mỗi nước một nhóm từ 08/10/2026).`,
        "",
        `📊 ${B("Ads")} tự gửi ${at || "08:30"} (kết quả hôm qua)${adsSlots ? ` và ${adsSlots} (số đang chạy hôm nay)` : ""}: `
            + `số tổng${market && market.sapChay ? "" : ", xếp hạng từng người"} và chi tiết từng camp của ${marketTitle}.`,
    ];
    if (market && market.sapChay) lines.push(I(`${market.ten} chưa nối shop POS — tin chỉ có tiền ads và tin nhắn, chưa có đơn/doanh số.`));
    if (hourlySlots && hourlySlots.length) {
        lines.push(`⏰ ${B("Mỗi giờ")} (${hourlySlots[0]} → ${hourlySlots[hourlySlots.length - 1]}, trừ giờ đã có bản tin ads): tiền ads, tin nhắn đếm từ Pancake, giá mỗi tin, đơn, doanh số — theo từng page.`);
    }
    lines.push(shipmentCfg
        ? `📦 ${B("Vận đơn")} tự gửi ${shipmentCfg.at || "08:30"}${shipmentCfg.toi ? ` và ${shipmentCfg.toi}` : ""}: khách phải gọi, nhắn (đủ tên, SĐT, tin soạn sẵn); `
            + `trạng thái lấy từ ${shipmentCfg.nguon || "bảng đối tác + 17TRACK"}.`
        : `📦 ${I(`Vận đơn ${market ? market.ten : "nước này"} chưa theo dõi — làm khi có đơn và biết hãng giao.`)}`);
    lines.push("", B("Gõ trong nhóm:"),
        "• /baocao — số đang chạy hôm nay · /baocao homqua · /baocao 14/09",
        `• /baocao ${example} — chi tiết campaign của một người ở nước này`,
        "• /baocao team — chỉ số tổng, không kèm camp",
        "• /canhbao — camp đốt tiền không ra tin nhắn");
    if (hourlySlots && hourlySlots.length) lines.push("• /gio — số mỗi giờ (ads + tin nhắn + đơn theo page) ngay lúc gõ");
    if (shipmentCfg) lines.push("• /vandon — danh sách vận đơn mới nhất");
    lines.push(I("Có dấu hay không dấu đều được."));
    return lines.join("\n");
}

module.exports = { parseCommand, adsHelpMessage, shipmentHelpMessage, marketHelpMessage, dayBefore, stripAccents };
