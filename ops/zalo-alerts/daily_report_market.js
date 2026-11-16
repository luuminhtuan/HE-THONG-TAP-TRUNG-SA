// Tin ADS MỘT NƯỚC + /canhbao một nước (tách từ daily_report.js 16/11/2026).
const { B, I } = require("./zalo_text");
const { DISPLAY, MARKETS, isTestCampaign, campaignMarket } = require("./rules");
const {
    fmt, p1, ddmm, compactMoney, closeRateText, FORMER_MARKETERS, UNASSIGNED_TAB, marketerOf,
    fetchRealtime, fetchSheetReport, dayBefore, trendArrow,
} = require("./daily_report_common");
const { skippedAccountsNote, sheetMissingToday, buildStaleWarning } = require("./daily_report_stale");
const { appendCampaignDetails } = require("./daily_report_campaigns");

// ═══════════════════════════════════════════════════════════════════════════════════════
// TIN ADS MỘT NƯỚC — nhóm "ADS + VẬN ĐƠN <nước>" (Sỹ Anh chốt 08/10/2026: mỗi nước một nhóm,
// ads + vận đơn chung nhóm, bỏ nhóm BÁO CÁO ADS gộp). Cùng khuôn tin đã duyệt 26/09 (số đầu
// tin · xếp hạng · chi tiết MỌI camp tên đầy đủ), nhưng chỉ số + camp của MỘT nước.
//
// Số lấy ở đâu:
//   1. bản số theo nước (bảng market_monthly_reports) — format_all.py ghi NGAY SAU bảng TỔNG TEAM, cùng
//      bộ ô: { nuoc: { Taiwan: { "2026-10-08": { Loc: {ads, mess, don, doanh_so, ds_giao_tc} …
//      "(không gán)": {…} } } } }. Cộng người trong team = đúng tab nước của Sheet, và có luôn
//      xếp hạng người TRONG nước — thứ file TỔNG TEAM không có (tab người gộp mọi nước).
//   2. Chưa có file đó (máy Mac, hoặc vòng ghi Sheet chưa chạy bản mới) hoặc file cũ hơn vòng ghi
//      Sheet OK gần nhất → tab nước của TỔNG TEAM (/api/talpha/sheet-report): đủ số đầu tin,
//      không có xếp hạng người.
// Chi tiết camp: /api/talpha/realtime lọc theo nước của tên camp (campaignMarket) — bot gọi MỘT
// lần mỗi mốc cho cả bốn nước (opts.layRealtime).
// ═══════════════════════════════════════════════════════════════════════════════════════
const emptyNumbers = () => ({ ads: 0, mess: 0, don: 0, doanh_so: 0, ds_giao_tc: 0 });
const withRates = (s) => ({
    ...s,
    ty_le_chot: s.mess > 0 ? (s.don / s.mess) * 100 : 0,
    phan_tram_ads: s.doanh_so > 0 ? (s.ads / s.doanh_so) * 100 : 0,
});
const METRIC_KEYS = ["ads", "mess", "don", "doanh_so", "ds_giao_tc"];

/**
 * Số một nước một ngày → { team, nguoi: [{tab, mk, …so}] | null, khongGan, nguon: "ban" | "sheet" }.
 * nguoi null = không có xếp hạng (đang đọc tab nước của Sheet).
 */
async function fetchMarketNumbers(cfg, dateStr, n, opts, f) {
    const marketReport = opts.docBan ? await opts.docBan(dateStr.slice(0, 7)) : null;
    const marketReportStale = marketReport && opts.stale && opts.stale.lastOkTs != null && marketReport.ghi_luc
        && Date.parse(marketReport.ghi_luc) < opts.stale.lastOkTs - 45 * 60000;
    if (marketReport && !marketReportStale) {
        const kg = marketReport.khong_gan || UNASSIGNED_TAB;
        const ng = ((marketReport.nuoc || {})[n.key] || {})[dateStr] || {};
        const perMarketer = Object.entries(ng).filter(([k]) => k !== kg)
            .map(([tab, v]) => withRates({ ...emptyNumbers(), ...v, tab, mk: DISPLAY[tab] || tab }));
        const team = emptyNumbers();
        for (const r of perMarketer) for (const k of METRIC_KEYS) team[k] += Number(r[k] || 0);
        return { team: withRates(team), nguoi: perMarketer, khongGan: ng[kg] ? withRates({ ...emptyNumbers(), ...ng[kg] }) : null, nguon: "ban" };
    }
    if (marketReportStale && opts.log) opts.log(`bao_cao_nuoc/${dateStr.slice(0, 7)}.json cũ hơn vòng ghi Sheet — đọc tab nước của TỔNG TEAM`);
    const sheet = await fetchSheetReport(cfg, dateStr, f);
    const r = (sheet.marketers || []).find((x) => x.tab === n.ten || x.tab === n.key);
    const team = emptyNumbers();
    if (r) for (const k of METRIC_KEYS) team[k] = Number(r[k] || 0);
    return { team: withRates(team), nguoi: null, khongGan: null, nguon: "sheet" };
}

/**
 * @param opts.nuoc        mã nước: TW · SG · AE · JP
 * @param opts.docBan      (thang "YYYY-MM") → bản số theo nước của tháng (bảng market_monthly_reports), hoặc null
 * @param opts.layRealtime (dateStr) → Promise<{campaigns}> — bot dùng chung một lượt cho bốn nước
 * Còn lại như buildMarketerReports: label, intraday, stale, tieuDe, nguon, soCungGio, khongSoCaNgay, log, fetch.
 * @returns { tinGop, teamMessage, tinNguoi(ten), nguoi, so, chuaDu, label }
 */
async function buildMarketReport(cfg, dateStr, opts = {}) {
    const n = MARKETS[String(opts.nuoc || "").toUpperCase()];
    if (!n) throw new Error(`nước lạ "${opts.nuoc}"`);
    const f = opts.fetch || fetch;
    const label = opts.label || ddmm(dateStr);
    const numbers = await fetchMarketNumbers(cfg, dateStr, n, opts, f);

    // ▲▼: mốc trưa/chiều so CÙNG MỐC hôm qua (bot nhớ); tối so cả ngày hôm qua của chính nước đó.
    let previous = null;
    if (opts.intraday && opts.soCungGio && opts.soCungGio.so) previous = { team: opts.soCungGio.so, nhan: opts.soCungGio.nhan };
    else if (opts.intraday && !opts.khongSoCaNgay) {
        try { previous = { team: (await fetchMarketNumbers(cfg, dayBefore(dateStr), n, opts, f)).team }; }
        catch (e) { if (opts.log) opts.log(`không lấy được số hôm qua của ${n.ma} để so: ${e.message}`); }
    }
    const staleWarning = buildStaleWarning(opts.stale, dateStr, opts.intraday);
    opts = { ...opts, canhBao: staleWarning, label, khongDon: n.sapChay, camNuoc: true };

    let camps = [], campaignError = "";
    try {
        const data = opts.layRealtime ? await opts.layRealtime(dateStr) : await fetchRealtime(cfg, dateStr, f);
        camps = (data.campaigns || []).filter((c) => (c.spend_vnd || 0) > 0 && !isTestCampaign(c.campaign_name)
            && campaignMarket(c.campaign_name).market === n.key);
    } catch (e) {
        campaignError = e.message;
        if (opts.log) opts.log(`realtime lỗi — tin ${n.ma} không kèm chi tiết campaign: ${e.message}`);
    }

    // Nước Meta không báo tin nhắn (Nhật, 09/10/2026): số mess lấy từ Pancake (tin_gio.messThayTuPancake)
    // — thay cho cả số đầu tin, từng người và từng camp. Không lấy được thì giữ số Meta, tin ghi rõ.
    const mt = opts.messThay;
    if (mt) {
        numbers.team.mess = mt.tong;
        Object.assign(numbers.team, withRates(numbers.team));
        for (const r of numbers.nguoi || []) { r.mess = mt.theoNguoi[r.mk] || 0; Object.assign(r, withRates(r)); }
        camps = camps.map((c) => ({ ...c, messages: mt.theoCamp[c.campaign_name] || 0 }));
        // So ▲▼ với số Sheet (mess Meta = 0) là ▲ giả — bỏ ▲▼ mess khi số trước không phải từ bot.
        if (previous && !previous.nhan) previous = { ...previous, team: { ...previous.team, mess: null } };
    }

    const rows = (numbers.nguoi || [])
        .filter((r) => !FORMER_MARKETERS.has(r.mk) && (r.ads > 0 || r.don > 0 || r.mess > 0))
        .sort((a, b) => (n.sapChay ? 0 : b.doanh_so - a.doanh_so) || (b.ads - a.ads));
    const renderMessage = (withCamps) => buildMarketMessage({ n, dateStr, so: numbers, rows, truoc: previous, camps: withCamps, cfg, canhBaoCamp: campaignError, opts });

    return {
        dateStr, label, nuoc: n.ma, nguoi: rows.map((r) => r.mk),
        tinGop: renderMessage(camps),
        teamMessage: renderMessage(null),
        tinNguoi: (marketer) => {
            const r = rows.find((x) => x.mk === marketer);
            const ownCamps = camps.filter((c) => marketerOf(c.campaign_name, true) === marketer);
            if (!r && !ownCamps.length) return `ℹ️ ${marketer} chưa có số ở ${n.flag} ${n.ten} ${opts.intraday ? "hôm nay" : "ngày " + ddmm(dateStr)}.`;
            const x = r || withRates(emptyNumbers());
            const lines = [B(`📊 ADS ${n.flag} ${n.ten.toUpperCase()} · ${label} — ${marketer}`)];
            if (staleWarning) lines.unshift(staleWarning.replace(/\n+$/, ""), "");
            lines.push(n.sapChay
                ? `💰 Ads ${B(fmt(Math.round(x.ads)) + "đ")} · ${fmt(x.mess)} mess${x.mess > 0 ? ` · ${compactMoney(x.ads / x.mess)}/mess` : ""}`
                : `💰 Ads ${B(fmt(Math.round(x.ads)) + "đ")} · DS ${B(fmt(Math.round(x.doanh_so)) + "đ")} · %ads ${B(x.doanh_so > 0 ? p1(x.phan_tram_ads) + "%" : "—")}\n`
                  + `🛒 ${fmt(x.don)} đơn · ${fmt(x.mess)} mess · chốt ${closeRateText(x.don, x.mess)}`);
            if (!r && numbers.nguoi === null) lines.push(I("(số theo người chưa có — đang đọc tab nước của file TỔNG TEAM)"));
            return appendCampaignDetails(lines, { camps: ownCamps, cfg, canhBaoCamp: campaignError, opts });
        },
        chuaDu: staleWarning !== "",
        so: { ads: Math.round(numbers.team.ads), don: numbers.team.don, mess: numbers.team.mess, doanh_so: Math.round(numbers.team.doanh_so) },
    };
}

// camps null → chỉ phần đầu tin (lệnh /baocao team), không kèm chi tiết camp.
function buildMarketMessage({ n, dateStr, so: numbers, rows, truoc: previous, camps, cfg, canhBaoCamp: campaignError, opts }) {
    const T = numbers.team, Tc = previous && previous.team;
    const mt = (k, isMoney) => (opts.intraday && Tc && Tc[k] != null ? trendArrow(Number(T[k] || 0), Number(Tc[k] || 0), isMoney) : "");
    const lines = [];
    if (opts.canhBao) lines.push(opts.canhBao.replace(/\n+$/, ""), "");
    const bq = skippedAccountsNote(opts.stale);
    if (bq) lines.push(bq, "");
    lines.push(B(opts.tieuDe || `📊 ADS ${n.flag} ${n.ten.toUpperCase()} · ${opts.label || ddmm(dateStr)}`));
    if (opts.nguon) lines.push(I(opts.nguon));
    lines.push("");
    const finish = () => (camps ? appendCampaignDetails(lines, { camps, cfg, canhBaoCamp: campaignError, opts }) : lines.join("\n"));

    if (sheetMissingToday(T, opts, dateStr)) {
        lines.push(`💰 ${B("Sheet chưa có số hôm nay")} — vòng ghi Sheet chưa chạy được lần nào từ 00:00.`);
        const spendTotal = (camps || []).reduce((s, c) => s + (c.spend_vnd || 0), 0);
        if (spendTotal > 0) lines.push(`Ads theo Meta (trực tiếp): ${B(fmt(Math.round(spendTotal)) + "đ")} — từng camp ở dưới`);
        return finish();
    }
    if (n.sapChay) {
        lines.push(`💰 Ads ${B(fmt(Math.round(T.ads)) + "đ")}${mt("ads", true)} · ${fmt(T.mess)} mess${mt("mess")}`
            + (T.mess > 0 ? ` · ${compactMoney(T.ads / T.mess)}/mess` : ""));
        lines.push(I(`🛒 ${n.ten} chưa nối shop POS — chưa có đơn, doanh số.`));
    } else {
        lines.push(`💰 Ads ${B(fmt(Math.round(T.ads)) + "đ")}${mt("ads", true)} · DS ${B(fmt(Math.round(T.doanh_so)) + "đ")}${mt("doanh_so", true)}`
            + ` · %ads ${B(T.doanh_so > 0 ? p1(T.phan_tram_ads) + "%" : "—")}`);
        lines.push(`🛒 ${fmt(T.don)} đơn${mt("don")} · ${fmt(T.mess)} mess${mt("mess")} · chốt ${p1(T.ty_le_chot)}%`);
    }
    rows.forEach((r, i) => {
        const head = `${i === 0 ? "🏆 " : "    "}${B(r.mk)} `;
        lines.push(n.sapChay
            ? `${head}ads ${compactMoney(r.ads)} · ${fmt(r.mess)} mess`
            : `${head}${compactMoney(r.doanh_so)} · ${fmt(r.don)} đơn · ads ${compactMoney(r.ads)} · %ads ${r.doanh_so > 0 ? Math.round(r.phan_tram_ads) + "%" : "—"}`);
    });
    if (numbers.nguoi === null) lines.push(I("(chưa có xếp hạng theo người — đang đọc tab nước của file TỔNG TEAM)"));
    const un = numbers.khongGan;
    if (un && (un.doanh_so > 0 || un.don > 0)) lines.push(`📍 Chưa gán cho ai: ${compactMoney(un.doanh_so)} · ${fmt(un.don)} đơn`);
    if (opts.intraday && Tc) lines.push(I(`▲▼ so với ${(previous && previous.nhan) || "cả ngày hôm qua"}`));
    return finish();
}

/** /canhbao trong nhóm một nước: camp của nước đó tiêu từ adsWasteSpend mà 0 tin nhắn (Meta trực tiếp). */
function buildMarketAlert(todayCamps, cfg, marketCode, dateStr) {
    const n = MARKETS[marketCode];
    const camps = (todayCamps || []).filter((c) => (c.spend_vnd || 0) > 0 && campaignMarket(c.campaign_name).market === n.key);
    const total = camps.reduce((s, c) => s + (c.spend_vnd || 0), 0);
    const threshold = cfg.adsWasteSpend || 300000;
    const burning = camps.filter((c) => c.spend_vnd >= threshold && !(c.messages > 0)).sort((a, b) => b.spend_vnd - a.spend_vnd);
    const head = `${I(`${n.flag} ${n.ten} · hôm nay ${ddmm(dateStr)} · Meta trực tiếp`)}\nChi tiêu: ${fmt(Math.round(total))}đ · ${camps.length} camp\n`;
    if (!burning.length) {
        return `✅ ${B("ADS — chưa thấy gì bất thường")}\n${head}Không camp nào tiêu từ ${fmt(threshold)}đ mà 0 tin nhắn.`;
    }
    return `🔥 ${B(`Camp ĐỐT TIỀN KHÔNG RA TIN NHẮN (${burning.length})`)}\n${head}`
        + burning.slice(0, 12).map((c) => `\n• ${fmt(Math.round(c.spend_vnd))}đ · 0 tin nhắn${marketerOf(c.campaign_name, true) ? " · " + marketerOf(c.campaign_name, true) : ""}\n   ${String(c.campaign_name || "").trim()}`).join("")
        + (burning.length > 12 ? `\n…và ${burning.length - 12} camp khác.` : "");
}

module.exports = { fetchMarketNumbers, buildMarketReport, buildMarketMessage, buildMarketAlert };
