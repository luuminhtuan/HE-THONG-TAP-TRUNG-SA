// Báo cáo ads: 1 tin TỔNG TEAM (gửi trước) + MỖI marketer 1 tin riêng.
// Dùng cho CẢ hai loại mốc: 8h30 (số HÔM QUA, đã chốt ngày) và giữa ngày 13:30 / 22:00
// (số HÔM NAY đang chạy). Khác nhau đúng ở phần chữ: truyền opts.intraday để tin nói rõ
// số chưa chốt — cùng một con số mà không ghi rõ mốc thì người đọc tưởng ngày tụt doanh thu.
//
// Gốc chép từ daily_report.js của bot WhatsApp cũ (đã xoá 30/10/2026), sửa bốn chỗ:
//   1. chữ đậm/nghiêng đi bằng B()/I() (zalo_text.js) — Zalo không đọc *…* và _…_;
//   2. thứ tự tin riêng theo khối marketers trong talpha_rules.json, không gõ tay tên;
//   3. tên sản phẩm theo chuẩn tên campaign mới, có cờ nước cho Singapore, UAE; chủ
//      campaign theo luật của Sheet chứ không quét cả tên (rules.js → chuCamp);
//   4. /api/talpha/realtime lỗi thì VẪN gửi — số đầu bài lấy từ Sheet, chỉ thiếu phần
//      chi tiết campaign (bản WhatsApp mất cả báo cáo vì phần phụ này).
//
// Số ĐẦU BÀI của mọi tin đọc THẲNG từ file Google Sheet "TỔNG TEAM THÁNG n" — đúng file
// CEO đang xem. Bot từng tự tính lại số, và cứ mỗi lần rule đổi là tin nhắn lệch với
// Sheet: lần do camp test, lần do cách gán đơn, lần do hai bên gom ngày theo hai múi giờ
// khác nhau. Đọc thẳng ô trong Sheet thì không còn chỗ nào để lệch.
// Phần "Theo campaign" lấy từ /api/talpha/realtime (Meta + POS live), đơn gán theo
// quảng cáo — nên cộng lại có thể khác số đầu bài, và tin nói rõ điều đó.
//
// Tách 16/11/2026 (file này chỉ còn buildMarketerReports; module.exports giữ nguyên):
//   daily_report_common.js     — định dạng số, chủ camp, gọi realtime / sheet-report, tab marketer
//   daily_report_stale.js      — cảnh báo "SỐ CHƯA ĐỦ"
//   daily_report_campaigns.js  — chi tiết camp theo marketer
//   daily_report_team.js       — tin ads / tin gộp / tin TỔNG TEAM / đề xuất
//   daily_report_market.js     — tin ads một nước, /canhbao một nước
//   daily_report_correction.js — tin đính chính
const { B, I } = require("./zalo_text");
const { DISPLAY, MARKETER_ORDER, isTestCampaign, shortCampaignName } = require("./rules");
const {
    fmt, pct, p1, ddmm, closeRateText, FORMER_MARKETERS, UNASSIGNED_TAB, marketerOf,
    fetchRealtime, fetchSheetReport, tabMarketer, dayBefore,
} = require("./daily_report_common");
const { buildStaleWarning, resolveStaleWarning, systemHealthNotes } = require("./daily_report_stale");
const { buildAdsMessage, buildTeamReport, buildCombinedMessage, recommend } = require("./daily_report_team");
const { buildMarketReport, buildMarketAlert } = require("./daily_report_market");
const { buildCorrectionMessage, diffLines } = require("./daily_report_correction");

// Số ĐẦU BÀI của tin — bốn con số người đọc nhớ. Tin đính chính so số cũ ↔ số đúng bằng đây.
const headlineNumbers = (sheet) => ({
    ads: Math.round(Number(sheet.team.ads || 0)),
    don: Number(sheet.team.don || 0),
    mess: Number(sheet.team.mess || 0),
    doanh_so: Math.round(Number(sheet.team.doanh_so || 0)),
});

// opts.label    — chữ in trên đầu tin thay cho ngày thô ("HÔM NAY 02/09 · 13:30").
// opts.intraday — số chưa chốt ngày: thêm dòng nhắc + đổi lời chú thích DS giao.
// opts.stale    — tuổi số từ /api/talpha/sync-health (null = không biết, không cảnh báo).
// opts.fetch    — thay fetch khi test.
// opts.soCungGio — { so: soDauBai, nhan: "13:00 hôm qua" }: ▲▼ so với số bot đã báo CÙNG
//                  MỐC hôm qua, thay cho cả ngày hôm qua (mốc 13:00 · 18:00, Sỹ Anh thêm 29/09/2026).
// opts.khongSoCaNgay — true: không so với cả ngày hôm qua (13:00 mà so cả ngày thì chữ nào
//                  cũng ▼ nửa, đọc thành báo động giả). Thiếu soCungGio thì tin không có ▲▼.
async function buildMarketerReports(cfg, dateStr, opts = {}) {
    const f = opts.fetch || fetch;
    const label = opts.label || ddmm(dateStr);
    const sheet = await fetchSheetReport(cfg, dateStr, f);
    // Tin tối so với CẢ NGÀY hôm qua (▲▼). Hỏng thì bỏ phần so sánh, tin vẫn đi.
    let prevSheet = null;
    if (opts.intraday && opts.soCungGio && opts.soCungGio.so) {
        prevSheet = { team: opts.soCungGio.so, nhan: opts.soCungGio.nhan };
    } else if (opts.intraday && !opts.khongSoCaNgay) {
        try { prevSheet = await fetchSheetReport(cfg, dayBefore(dateStr), f); }
        catch (e) { if (opts.log) opts.log(`không lấy được số hôm qua để so: ${e.message}`); }
    }
    const staleWarning = buildStaleWarning(opts.stale, dateStr, opts.intraday);
    opts = { ...opts, canhBao: staleWarning };
    let camps = [], campaignError = "";
    try {
        const data = await fetchRealtime(cfg, dateStr, f);
        // Camp TEST cũng phải rời khỏi phần chi tiết, nếu không phần chi tiết lại lệch
        // với đầu bài của chính tin đó.
        camps = (data.campaigns || []).filter((c) => (c.spend_vnd || 0) > 0 && !isTestCampaign(c.campaign_name));
    } catch (e) {
        campaignError = e.message;
        if (opts.log) opts.log(`realtime lỗi — gửi tin không kèm chi tiết campaign: ${e.message}`);
    }

    // tab Sheet dùng KEY (Loc, Thuong…), tin nhắn hiển thị TÊN (Lộc, Thương…)
    const bySheet = {};
    for (const r of tabMarketer(sheet, opts.log)) bySheet[DISPLAY[r.tab] || r.tab] = r;

    const byMk = {};
    for (const c of camps) {
        const mk = marketerOf(c.campaign_name);
        if (mk) (byMk[mk] = byMk[mk] || []).push(c);   // camp không gán được → không vào tin cá nhân
    }

    const rankOf = (mk) => (MARKETER_ORDER.includes(mk) ? MARKETER_ORDER.indexOf(mk) : MARKETER_ORDER.length);
    // Ai có tin riêng: người có số trong Sheet, không phải người có campaign — người chi
    // 0đ mà vẫn có đơn về tag mình thì vẫn phải có tin.
    const names = Object.keys(bySheet)
        .filter((mk) => mk !== UNASSIGNED_TAB && !FORMER_MARKETERS.has(mk))
        .filter((mk) => bySheet[mk].ads > 0 || bySheet[mk].don > 0)
        .sort((a, b) => rankOf(a) - rankOf(b));

    // nguoi[i] là chủ của messages[i] — lệnh "/baocao Lộc" lấy đúng một tin.
    const messages = names.map((mk) => {
        const list = (byMk[mk] || []).sort((a, b) => b.spend_vnd - a.spend_vnd);
        const p = bySheet[mk];
        const spend = p.ads, rev = p.doanh_so, mess = p.mess, ord = p.don;
        // dùng luôn tỷ lệ Sheet đã tính, không tự chia lại rồi lệch số lẻ
        const closeR = p.ty_le_chot, adsR = p.phan_tram_ads;

        let m = resolveStaleWarning(opts, dateStr) + `📊 ${B(`ADS ${label} — ${mk}`)}\n`;
        m += `💰 Tiền ads: ${B(fmt(spend) + "đ")}  ·  Doanh số: ${B(fmt(rev) + "đ")}  ·  %ads: ${B(rev > 0 ? p1(adsR) + "%" : "—")}\n`;
        m += `💬 Mess: ${fmt(mess)}  ·  🛒 Đơn: ${fmt(ord)}  ·  ✅ Chốt: ${B(closeRateText(ord, mess))}\n`;
        if (opts.intraday) m += `${I("số đang chạy trong ngày — chưa chốt, còn lên tiếp")}\n`;
        if (list.length) {
            m += `\n${B("Theo campaign:")}  ${I("(đơn ở đây gán theo quảng cáo, nên tổng có thể khác số đầu bài — số đầu bài gán theo tag POS, khớp Sheet)")}`;
            for (const c of list.slice(0, cfg.topCampaigns || 8)) {
                const cr = pct(c.orders, c.messages), ar = pct(c.spend_vnd, c.revenue_vnd);
                m += `\n• ${shortCampaignName(c.campaign_name)}`;
                m += `\n   Ads ${fmt(c.spend_vnd)}đ · Mess ${c.messages || 0} · Đơn ${c.orders || 0} · Chốt ${p1(cr)}% · %ads ${c.revenue_vnd > 0 ? Math.round(ar) + "%" : "—"}`;
            }
        } else {
            m += `\n${I(campaignError
                ? "(chưa lấy được chi tiết campaign lúc này — số đầu bài vẫn đúng theo Sheet)"
                : "(không có campaign nào tiêu tiền)")}`;
        }
        const recs = recommend(list, { rev, closeR, adsR }, cfg);
        if (recs.length) m += `\n\n💡 ${B("Đề xuất:")}\n` + recs.map((r) => "• " + r).join("\n");
        return m;
    });
    const teamMessage = buildTeamReport(dateStr, sheet, { ...opts, label });
    return {
        dateStr, label, teamMessage, messages, nguoi: names,
        // chuaDu: tin này gửi khi số CHƯA ĐỦ → bot xếp lịch đính chính khi sync đủ số.
        chuaDu: staleWarning !== "", so: headlineNumbers(sheet),
        // MỘT tin duy nhất cho mốc tự gửi — Sỹ Anh chốt 16/09/2026: "nhiều tin quá bị loạn".
        // Sỹ Anh duyệt mẫu 26/09/2026: số tổng + theo nước + xếp hạng + CHI TIẾT MỌI CAMP
        // (tên đầy đủ trên Meta) theo marketer — bỏ phần đề xuất việc.
        tinGop: buildAdsMessage({ dateStr, sheet, sheetTruoc: prevSheet, camps, cfg, canhBaoCamp: campaignError, opts: { ...opts, label } }),
    };
}

module.exports = {
    buildMarketerReports, buildTeamReport, buildCombinedMessage, buildAdsMessage, recommend,
    buildCorrectionMessage, diffLines, headlineNumbers,
    buildMarketReport, buildMarketAlert, systemHealthNotes,
};
