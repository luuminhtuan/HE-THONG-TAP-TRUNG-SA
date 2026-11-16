// Tin ADS gộp mọi nước theo file TỔNG TEAM (tách từ daily_report.js 16/11/2026): tin ads duyệt mẫu
// 26/09, tin gộp, tin TỔNG TEAM, đề xuất việc. Hàm thuần.
const { B, I } = require("./zalo_text");
const { DISPLAY, MARKET_FLAGS, shortCampaignName } = require("./rules");
const {
    fmt, pct, p1, ddmm, compactMoney, FORMER_MARKETERS, UNASSIGNED_TAB, marketerOf, tabMarketer, trendArrow,
} = require("./daily_report_common");
const { skippedAccountsNote, sheetMissingToday, resolveStaleWarning } = require("./daily_report_stale");
const { appendCampaignDetails } = require("./daily_report_campaigns");

/**
 * TIN ADS — Sỹ Anh duyệt mẫu 26/09/2026 (bản 3). MỘT tin (dài thì chiaTin tự tách):
 *   đầu tin: tiền ads · doanh số · %ads · đơn · mess · chốt (tối có ▲▼ so cả ngày hôm qua),
 *            từng nước, xếp hạng marketer — số lấy thẳng file TỔNG TEAM như cũ;
 *   CHI TIẾT CAMP: mọi camp có tiêu tiền, TÊN ĐẦY ĐỦ như trên Meta Ads (dán vào Ads
 *            Manager là tìm ra), chia theo marketer, tiêu nhiều lên trước.
 * Bỏ phần "việc hôm nay" (Sỹ Anh chốt). Đơn trong chi tiết camp gán theo quảng cáo nên
 * cộng lại có thể khác đầu tin — tin nói rõ điều đó.
 *
 * opts.tieuDe / opts.nguon — dòng đầu và dòng nguồn số do bot dựng theo mốc (sáng/tối/gõ tay).
 */
function buildAdsMessage({ dateStr, sheet, sheetTruoc: prevSheet, camps, cfg, canhBaoCamp: campaignError, opts }) {
    const T = sheet.team;
    const Tc = prevSheet && prevSheet.team ? prevSheet.team : null;
    const hasComparison = !!(opts.intraday && Tc);
    const mt = (k, isMoney) => (hasComparison ? trendArrow(Number(T[k] || 0), Number(Tc[k] || 0), isMoney) : "");
    const lines = [];
    const cb = resolveStaleWarning(opts, dateStr);
    if (cb) lines.push(cb.replace(/\n+$/, ""), "");
    const bq = skippedAccountsNote(opts.stale);
    if (bq) lines.push(bq, "");
    lines.push(B(opts.tieuDe || `📊 ADS ${opts.label || ddmm(dateStr)}`));
    if (opts.nguon) lines.push(I(opts.nguon));
    lines.push("");
    if (sheetMissingToday(T, opts, dateStr)) {
        // Không có số Sheet → không in 0đ, không xếp hạng, không ▲▼. Tiền Meta trực tiếp thì có
        // (cùng nguồn với phần chi tiết camp bên dưới) nên vẫn đưa ra cho người đọc biết đang tiêu.
        lines.push(`💰 ${B("Sheet chưa có số hôm nay")} — vòng ghi Sheet chưa chạy được lần nào từ 00:00.`);
        const spendTotal = camps.reduce((s, c) => s + (c.spend_vnd || 0), 0);
        const mess = camps.reduce((s, c) => s + (c.messages || 0), 0);
        if (spendTotal > 0) lines.push(`Ads theo Meta (trực tiếp): ${B(fmt(Math.round(spendTotal)) + "đ")} · ${fmt(mess)} mess — từng camp ở dưới`);
        return appendCampaignDetails(lines, { camps, cfg, canhBaoCamp: campaignError, opts });
    }
    lines.push(`💰 Ads ${B(fmt(Math.round(T.ads)) + "đ")}${mt("ads", true)} · DS ${B(fmt(Math.round(T.doanh_so)) + "đ")}${mt("doanh_so", true)}`
        + ` · %ads ${B(T.doanh_so > 0 ? p1(T.phan_tram_ads) + "%" : "—")}`);
    lines.push(`🛒 ${fmt(T.don)} đơn${mt("don")} · ${fmt(T.mess)} mess${mt("mess")} · chốt ${p1(T.ty_le_chot)}%`);

    // Theo nước — tab nước của file TỔNG TEAM (Đài Loan, Singapore, UAE).
    const tabs = new Map((sheet.marketers || []).map((r) => [r.tab, r]));
    for (const n of MARKET_FLAGS) {
        const r = tabs.get(n.tab) || tabs.get(n.key);
        if (!r || !(r.ads > 0 || r.don > 0)) continue;
        const ds = r.don > 0 || r.doanh_so > 0 ? `${fmt(r.don)} đơn · ${compactMoney(r.doanh_so)}` : "0 đơn";
        lines.push(`${n.flag} ${ds} · ${r.ads > 0 ? `%ads ${r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—"}` : "chưa chạy ads"}`);
    }

    // Xếp hạng marketer theo doanh số.
    const rows = tabMarketer(sheet)
        .filter((r) => r.tab !== UNASSIGNED_TAB && (r.ads > 0 || r.don > 0))
        .map((r) => ({ ...r, mk: DISPLAY[r.tab] || r.tab }))
        .filter((r) => !FORMER_MARKETERS.has(r.mk))
        .sort((a, b) => (b.doanh_so - a.doanh_so) || (b.ads - a.ads));
    rows.forEach((r, i) => {
        lines.push(`${i === 0 ? "🏆 " : "    "}${B(r.mk)} ${compactMoney(r.doanh_so)} · ${fmt(r.don)} đơn · %ads ${r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—"}`);
    });
    const un = (sheet.marketers || []).find((r) => r.tab === UNASSIGNED_TAB);
    if (un && (un.doanh_so > 0 || un.don > 0)) lines.push(`📍 Chưa gán cho ai: ${compactMoney(un.doanh_so)} · ${fmt(un.don)} đơn`);
    if (hasComparison) lines.push(I(`▲▼ so với ${prevSheet.nhan || "cả ngày hôm qua"}`));
    return appendCampaignDetails(lines, { camps, cfg, canhBaoCamp: campaignError, opts });
}

/**
 * TIN GỘP — tất cả trong MỘT tin (Sỹ Anh chốt 16/09/2026: sáu tin một lượt là loạn nhóm).
 *
 * Lấy nguyên tin TỔNG TEAM (đã có số tổng + bảng xếp hạng từng người) rồi thêm hai dòng
 * campaign đáng làm gì đó. CỐ Ý bỏ phần chi tiết từng campaign của từng người: gộp hết
 * vào là tin dài gấp ba lần khung 1800 ký tự của Zalo, lại bị chia thành mấy tin — đúng
 * cái đang muốn tránh. Ai cần chi tiết thì gõ /baocao <tên>.
 */
function buildCombinedMessage({ dateStr, sheet, camps, cfg, canhBaoCamp: campaignError, opts }) {
    let m = "";
    const shortName = (c) => shortCampaignName(c.campaign_name);
    const ownerSuffix = (c) => { const k = marketerOf(c.campaign_name); return k ? ` (${k})` : ""; };

    const burning = camps
        .filter((c) => c.spend_vnd >= (cfg.recWasteSpend || 300000) && !(c.orders > 0))
        .sort((a, b) => b.spend_vnd - a.spend_vnd);
    if (burning.length) {
        m += `\n\n🔥 ${B(`Đốt tiền không ra đơn (${burning.length})`)}: `
            + burning.slice(0, 3).map((c) => `${shortName(c)} ${compactMoney(c.spend_vnd)}${ownerSuffix(c)}`).join(" · ")
            + (burning.length > 3 ? " …" : "");
    }
    const winners = camps
        .filter((c) => c.revenue_vnd > 0 && (c.orders || 0) >= 3 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20))
        .sort((a, b) => b.revenue_vnd - a.revenue_vnd);
    if (winners.length) {
        m += `\n💡 ${B("Đang ngon")}: `
            + winners.slice(0, 2).map((c) => `${shortName(c)} ${c.orders} đơn · %ads ${Math.round(pct(c.spend_vnd, c.revenue_vnd))}%${ownerSuffix(c)}`).join(" · ");
    }
    if (campaignError) m += `\n\n${I("(chưa lấy được danh sách campaign lúc này — số đầu bài vẫn đúng theo Sheet)")}`;
    return buildTeamReport(dateStr, sheet,
        { ...opts, themVao: m, themCuoi: " · gõ /baocao <tên> để xem chi tiết campaign của một người" });
}

// Tin TỔNG TEAM — số lấy thẳng dòng TỔNG của Sheet, cùng bảng xếp hạng từng người. Ô
// "(không gán)" KHÔNG nằm trong dòng TỔNG nhưng là tiền thật — nêu riêng chứ không giấu.
function buildTeamReport(dateStr, sheet, opts = {}) {
    const label = opts.label || ddmm(dateStr);
    const T = sheet.team;
    const marketers = tabMarketer(sheet);
    const ds = (r) => (r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—");

    let m = resolveStaleWarning(opts, dateStr) + `🏆 ${B(`TỔNG TEAM — ${label}`)}\n`;
    m += `💰 Tiền ads: ${B(fmt(Math.round(T.ads)) + "đ")}  ·  Doanh số: ${B(fmt(Math.round(T.doanh_so)) + "đ")}  ·  %ads: ${B(T.doanh_so > 0 ? p1(T.phan_tram_ads) + "%" : "—")}\n`;
    m += `💬 Mess: ${fmt(T.mess)}  ·  🛒 Đơn: ${fmt(T.don)}  ·  ✅ Chốt: ${B(p1(T.ty_le_chot) + "%")}\n`;
    // Đơn COD vài ngày mới giao xong, nên DS giao của ngày vừa qua LUÔN thấp — ghi rõ để
    // không ai tưởng doanh số tụt.
    m += `📦 DS giao thành công: ${fmt(Math.round(T.ds_giao_tc))}đ ${I(opts.intraday
        ? "(đơn hôm nay gần như chưa giao xong — số này còn lên nhiều)"
        : "(đơn hôm qua phần lớn chưa giao xong — số này còn lên)")}\n`;

    const rows = marketers
        .filter((r) => r.tab !== UNASSIGNED_TAB && (r.ads > 0 || r.don > 0))
        .map((r) => ({ ...r, mk: DISPLAY[r.tab] || r.tab }))
        .filter((r) => !FORMER_MARKETERS.has(r.mk))
        .sort((a, b) => (b.doanh_so - a.doanh_so) || (b.ads - a.ads));

    if (rows.length) {
        const top = rows[0];
        if (top.doanh_so > 0) {
            m += `\n👑 ${B(`Top 1 ${opts.intraday ? "hôm nay" : "ngày " + ddmm(dateStr)}: ${top.mk} — ${fmt(Math.round(top.doanh_so))}đ`)}\n`;
        }
        m += `\n${B("Xếp hạng theo doanh số:")}`;
        rows.forEach((r, i) => {
            m += `\n${i === 0 && r.doanh_so > 0 ? "👑" : i + 1 + "."} ${B(r.mk)} — Ads ${fmt(Math.round(r.ads))}đ · DS ${fmt(Math.round(r.doanh_so))}đ · %ads ${ds(r)} · ${fmt(r.don)} đơn · chốt ${p1(r.ty_le_chot)}%`;
        });
    }

    const un = marketers.find((r) => r.tab === UNASSIGNED_TAB);
    if (un && (un.doanh_so > 0 || un.don > 0)) {
        m += `\n\n📍 Chưa gán được cho ai: ${fmt(Math.round(un.doanh_so))}đ · ${fmt(un.don)} đơn — nằm ngoài bảng trên.`;
    }
    if (opts.themVao) m += opts.themVao;           // tin gộp chèn phần campaign ở đây
    // Chú thích nguồn số + (tin gộp) chỗ lấy chi tiết — GỘP một dòng, càng ít dòng càng dễ đọc.
    m += `\n${I(`số lấy thẳng từ file TỔNG TEAM THÁNG ${Number(dateStr.slice(5, 7))}${opts.themCuoi || ""}`)}`;
    return m;
}

function recommend(list, agg, cfg) {
    const r = [];
    const waste = list.filter((c) => c.spend_vnd >= (cfg.recWasteSpend || 300000) && (c.orders || 0) === 0);
    if (waste.length) r.push(`Tắt / đổi sản phẩm ${waste.length} camp đốt tiền không ra đơn: ${waste.slice(0, 3).map((c) => shortCampaignName(c.campaign_name)).join(", ")}`);
    const lowClose = list.filter((c) => (c.messages || 0) >= 20 && pct(c.orders, c.messages) < (cfg.recLowClosePct || 5));
    if (lowClose.length) r.push(`Chốt thấp (<${cfg.recLowClosePct || 5}%) ở ${lowClose.length} camp — kiểm tra sale chốt & target`);
    if (agg.rev > 0 && agg.adsR > (cfg.recHighAdsPct || 30)) r.push(`%ads cao (${Math.round(agg.adsR)}%) — đang ăn mòn lãi, siết ngân sách các camp kém`);
    const win = list.filter((c) => c.revenue_vnd > 0 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20) && (c.orders || 0) >= 3);
    if (win.length) r.push(`Tăng ngân sách ${win.length} camp hiệu quả (%ads thấp): ${win.slice(0, 3).map((c) => shortCampaignName(c.campaign_name)).join(", ")}`);
    if (!r.length && list.length) r.push("Chỉ số ổn định — duy trì và theo dõi.");
    return r;
}

module.exports = { buildAdsMessage, buildCombinedMessage, buildTeamReport, recommend };
