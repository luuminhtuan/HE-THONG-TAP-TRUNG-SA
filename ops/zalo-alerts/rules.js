// TALPHA — đọc rule chung cho bot Zalo (CommonJS).
// Nguồn DUY NHẤT: config/talpha_rules.json (repo root — máy chủ: /opt/talpha/config/).
// Cùng luật với lib/talpha/rules.ts và ops/talpha_reports/talpha_rules.py.
//
// KHÔNG có bảng dự phòng: bản WhatsApp giữ sẵn một bảng tên marketer thời GCC để dùng
// khi thiếu file, nghĩa là thiếu file thì bot vẫn chạy — với danh sách người đã nghỉ.
// Thiếu file ở đây là dừng luôn, không gửi số gán sai người vào nhóm.
const fs = require("fs");
const path = require("path");

const { applyMarketOverrides, loadMarketOverrides } = require("./thi_truong");

const RULES_FILE = path.join(__dirname, "..", "..", "config", "talpha_rules.json");
// Đã phủ thị trường nhập ở /admin → Thị trường (04/11/2026, xem thi_truong.js) — nước thêm, sửa,
// tắt trên trang tới bot ngay lần khởi động sau.
const RULES = applyMarketOverrides(JSON.parse(fs.readFileSync(RULES_FILE, "utf8")), loadMarketOverrides());

const withoutNotes = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith("_")));

// Key marketer → tên hiển thị, ĐÚNG thứ tự khai trong JSON — cũng là thứ tự tin riêng.
const MARKETERS = withoutNotes(RULES.marketers);
const DISPLAY = Object.fromEntries(Object.entries(MARKETERS).map(([k, v]) => [k, v.display || k]));
const MARKETER_ORDER = Object.keys(MARKETERS).map((k) => DISPLAY[k]);
// Người đã nghỉ: không có tin riêng, không vào bảng xếp hạng (khối unassign_marketers).
const UNASSIGN = new Set(RULES.unassign_marketers || []);

// File TỔNG TEAM có thêm tab theo NƯỚC từ 15/09/2026 ("Đài Loan", "Singapore"…), nằm lẫn
// với tab marketer. Tab nào trùng tên hiển thị (hoặc key) của một nước là tab nước.
const MARKET_TABS = new Set(Object.entries(withoutNotes(RULES.markets)).flatMap(([key, v]) => [key, v.display || key]));
// Tab nước → cờ, theo thứ tự khai trong markets (Đài, Singapore, UAE) — dòng "theo nước" của tin ads.
const MARKET_FLAGS = Object.entries(withoutNotes(RULES.markets)).map(([key, v]) => ({ key, tab: v.display || key, flag: v.flag || "" }));

// Mã nước (mã shop: TW, SG, AE, JP) → { key: khoá trong markets, ten, flag, sapChay, daTat }. Nhóm
// Zalo "ADS + VẬN ĐƠN <nước>" (08/10/2026) đặt theo mã này. sapChay = nước chưa có shop POS (Nhật lúc
// mở) — chỉ có tiền ads + tin nhắn, tin không in đơn / doanh số / %ads. daTat (04/11/2026) = nước đã
// tắt — bot không tự gửi tin gì cho nước đó nữa (bot.js lọc khỏi mọi lịch).
const MARKETS = Object.fromEntries(Object.entries(withoutNotes(RULES.markets))
    .filter(([, v]) => v && typeof v === "object" && v.shop_label)
    .map(([key, v]) => {
        const code = String(v.shop_label).toUpperCase();
        return [code, { ma: code, key, ten: v.display || key, flag: v.flag || "", sapChay: v.status === "sap_chay", daTat: v.status === "da_tat" }];
    }));

const CAMP_TOKENS = withoutNotes(RULES.camp_marketer_tokens);
const CAMP_MARKETS = Object.fromEntries((RULES.camp_market_tokens || []).map((t) => [t, RULES.market_aliases[t]]));
const PRIMARY_MARKET = RULES.primary_market || null;

/** Một ô tên campaign → key marketer theo mã (LOC, THUONG, SANH…); null nếu không phải ô marketer. */
function normCampMarketer(s) {
    if (!s) return null;
    return CAMP_TOKENS[String(s).trim().toUpperCase().replace(/\./g, "").replace(/ /g, "")] || null;
}

/**
 * Chủ của campaign — ĐÚNG luật Sheet dùng (ops/talpha_reports/format_all.py → parse_camp),
 * vì số đầu bài của mọi tin là số Sheet:
 *   - có ô nước → marketer là ô NGAY SAU ô nước;
 *   - không ô nước (tên cũ) → marketer là ô đầu hoặc ô hai;
 *   - không khớp → null. KHÔNG quét cả tên.
 * Bot WhatsApp quét cả tên (scanCampaignMarketer) và gán sai người: 14/09/2026 camp
 * "TW/THUONG/VN/TEST/Trang Sức Vàng Thái/…" vào tin của Thái vì tên trang có chữ "Thái",
 * trong khi Sheet tính cho Thương.
 */
function campaignOwner(cn) {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    if (mi >= 0) return mi + 1 < p.length ? normCampMarketer(p[mi + 1]) : null;
    const o = p.slice(0, 2).find((s) => normCampMarketer(s));
    return o ? normCampMarketer(o) : null;
}

/**
 * Tên campaign → { market, source }. ≡ campaignMarket() bên rules.ts:
 * 'o_dau' ô đầu là nước · 'o_khac' nước ở ô khác · 'mac_dinh' không ghi nước → primary_market.
 */
function campaignMarket(cn) {
    const p = String(cn || "").split("/").map((x) => x.trim());
    for (let i = 0; i < p.length; i++) {
        const m = CAMP_MARKETS[p[i].toUpperCase()];
        if (m) return { market: m, source: i === 0 ? "o_dau" : "o_khac" };
    }
    return { market: PRIMARY_MARKET, source: "mac_dinh" };
}

/** Campaign test sản phẩm — tách khỏi báo cáo doanh số, trừ nước được miễn. ≡ rules.ts */
function isTestCampaign(cn) {
    const tc = RULES.test_campaign || {};
    if (!tc.pattern) return false;
    if ((tc.exempt_markets || []).includes(campaignMarket(cn).market)) return false;
    try { return new RegExp(tc.pattern).test(String(cn || "")); }
    catch { return false; }
}

/**
 * Tên ngắn của campaign cho dòng chi tiết: mã sản phẩm, kèm cờ nếu không phải nước chính.
 *
 * Mã sản phẩm đứng SAU ô tệp khách, mà ô tệp khách đứng sau ô marketer — nên tìm ô
 * marketer rồi đếm tiếp, thay vì lấy cứng ô thứ ba như bản WhatsApp. Lấy cứng thì tên
 * chuẩn mới `TW/LOC/PHI/072-DENTAL/…` ra "PHI" (tệp khách) cho mọi dòng.
 *   Lộc/Philippine/042 - BLACK/…          → 042 - BLACK      (tên cũ, marketer ở ô 1)
 *   TW/LOC/PHI/072 - DENTAL/…             → 072 - DENTAL
 *   SG/LOC/PHI/075 - SETTS01/…            → 🇸🇬 075 - SETTS01
 *   TW/THUONG/VN/TEST/BaloDaGiaTot/0709   → TEST · BaloDaGiaTot
 */
function shortCampaignName(name) {
    const p = String(name || "").split("/").map((s) => s.trim()).filter(Boolean);
    const mi = p.findIndex((s) => normCampMarketer(s) !== null);
    let product = mi >= 0 ? p[mi + 2] : undefined;
    let pageName = mi >= 0 ? p[mi + 3] : undefined;
    if (!product) { product = p[2] || p[1] || p[0] || String(name || ""); pageName = undefined; }
    if (/^test$/i.test(product) && pageName) product = `TEST · ${pageName}`;

    const { market, source } = campaignMarket(name);
    const flag = source !== "mac_dinh" && market !== PRIMARY_MARKET ? (RULES.markets[market] || {}).flag : "";
    const truncated = product.length > 38 ? product.slice(0, 38) + "…" : product;
    return flag ? `${flag} ${truncated}` : truncated;
}

/** Tên page để SO KHỚP — ≡ chuanTenPage (dashboard-ui/src/lib/talpha/pancake.ts) và normalize_page_name
 *  (talpha_rules.py): bỏ kiểu chữ trang trí (𝑱𝒂𝒑𝒂𝒏 → japan), hoa thường, dấu câu, khoảng trắng thừa. */
function normalizePageName(s) {
    return String(s || "").normalize("NFKC").toLowerCase()
        .replace(/[^\p{L}\p{N}_]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Ô TÊN PAGE trong tên campaign (NƯỚC/MARKETER/TỆP/SẢNPHẨM/TRANG/NGÀY) — ≡ trangCuaCamp bên TS. */
function pageOfCampaign(cn) {
    const p = String(cn || "").split("/").map((x) => x.trim());
    const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
    const k = mi >= 0 ? mi + 1 : p.slice(0, 2).findIndex((s) => normCampMarketer(s));
    if (k < 0) return null;
    return p[k + 3] || null;
}

/**
 * Tên nhóm Zalo → mã nước, CHỈ khi tên đúng mẫu "ADS + VẬN ĐƠN <nước>" (Sỹ Anh tạo 08/10/2026:
 * ADS + VẬN ĐƠN TAIWAN · SGP · UAE · JAPAN). Tin vận đơn có tên + SĐT khách nên khớp CHẶT: sai
 * mẫu → null, bot không tự nhận nhóm đó. Nước đọc theo market_aliases (TAIWAN, SGP, JAPAN…) hoặc
 * tên hiển thị / mã shop.
 */
function marketFromGroupName(groupName) {
    const normalized = String(groupName || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "D").toUpperCase();
    const m = /^\s*ADS\s*\+\s*VAN\s*DON\s+(.+?)\s*$/.exec(normalized);
    if (!m) return null;
    const marketPart = m[1].replace(/\s+/g, " ");
    const stripDiacritics = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "D").toUpperCase();
    for (const [tok, key] of Object.entries(withoutNotes(RULES.market_aliases))) {
        if (stripDiacritics(tok) === marketPart) return Object.values(MARKETS).find((n) => n.key === key)?.ma || null;
    }
    const n = Object.values(MARKETS).find((x) => stripDiacritics(x.ten) === marketPart || x.ma === marketPart || stripDiacritics(x.key) === marketPart);
    return n ? n.ma : null;
}

/**
 * Danh sách nhóm nick phụ đang ở → nhóm của từng nước theo tên. Một nước khớp HAI nhóm trở lên
 * thì KHÔNG chọn (trung) — đoán sai là tin có SĐT khách vào nhầm nhóm; người chọn tay bằng
 * `node pair.js --chon-nuoc <id> --nuoc <mã>`.
 * @returns { chon: {TW: nhóm…}, trung: {TW: [nhóm…]}, thieu: [mã…] }
 */
function pickGroupsByName(groups, marketCodes) {
    const byMarket = {};
    for (const g of groups || []) {
        const m = marketFromGroupName(g.name);
        if (m && marketCodes.includes(m)) (byMarket[m] = byMarket[m] || []).push(g);
    }
    const picked = {}, ambiguous = {}, missing = [];
    for (const m of marketCodes) {
        const xs = byMarket[m] || [];
        if (xs.length === 1) picked[m] = xs[0];
        else if (xs.length > 1) ambiguous[m] = xs;
        else missing.push(m);
    }
    return { chon: picked, trung: ambiguous, thieu: missing };
}

// ── Ai cầm nước nào (Sỹ Anh chốt 10/10/2026) — ≡ credited_marketer bên talpha_rules.py ──
// Số một người chạy LẤN sang nước của team khác (camp cũ chưa đổi tên) tính cho người cầm nước đó.
const MARKETS_BY_MARKETER = {};
for (const t of Object.values(withoutNotes((RULES.access || {}).teams))) {
    if (!t || typeof t !== "object") continue;
    for (const member of t.members || []) for (const m of t.markets || []) (MARKETS_BY_MARKETER[member] = MARKETS_BY_MARKETER[member] || new Set()).add(m);
}
const MARKET_OWNERS = Object.fromEntries(Object.entries(withoutNotes(RULES.markets)).filter(([, v]) => v && v.nguoi_cam).map(([k, v]) => [k, v.nguoi_cam]));
// Người đã ngừng chạy (marketers.*.ngung_chay_tu — Thương từ 01/10/2026, Sỹ Anh chốt 03/11/2026):
// từ ngày đó số mang tên họ tính cho người cầm nước. Không truyền ngày = số hiện tại.
const STOPPED_SINCE = Object.fromEntries(Object.entries(MARKETERS).filter(([, v]) => v && v.ngung_chay_tu).map(([k, v]) => [k, v.ngung_chay_tu]));
function creditedMarketer(key, marketKey, date) {
    const since = STOPPED_SINCE[key];
    if (since && (!date || String(date).slice(0, 10) >= since)) return MARKET_OWNERS[marketKey] || key;
    const ownMarkets = MARKETS_BY_MARKETER[key];
    if (!ownMarkets || ownMarkets.has(marketKey)) return key;
    return MARKET_OWNERS[marketKey] || key;
}
/** Chủ camp SAU khi chuyển số lấn nước — dùng cho mọi chỗ gom camp theo người. */
function creditedCampaignOwner(cn) {
    const k = campaignOwner(cn);
    return k ? creditedMarketer(k, campaignMarket(cn).market) : null;
}

module.exports = {
    MARKETS, marketFromGroupName, pickGroupsByName, normalizePageName, pageOfCampaign, creditedMarketer, creditedCampaignOwner,
    RULES, MARKETERS, DISPLAY, MARKETER_ORDER, UNASSIGN, PRIMARY_MARKET, MARKET_TABS, MARKET_FLAGS,
    campaignOwner, normCampMarketer, campaignMarket, isTestCampaign, shortCampaignName,
};
