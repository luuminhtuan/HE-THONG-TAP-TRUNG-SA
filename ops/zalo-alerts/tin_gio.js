// TIN MỖI GIỜ của một nước (Sỹ Anh yêu cầu 09/10/2026, trước mắt cho Nhật): quảng cáo ở Nhật
// KHÔNG có chỉ số tin nhắn trên Meta (luật bảo vệ thông tin liên lạc của Nhật), nên Ads Manager
// không cho biết mess, giá mess, đơn, doanh số. Tin này ghép ba nguồn theo PAGE:
//   • tiền ads từng camp — Meta trực tiếp (/api/talpha/realtime, bot gọi một lượt mỗi mốc);
//   • tin nhắn / bình luận mới / có SĐT — Pancake (/api/talpha/pancake-messages);
//   • đơn + doanh số — bảng đơn POS, cùng luật Sheet (/api/talpha/pancake-messages).
// Camp nối page bằng ô tên page trong tên camp (mỗi camp Nhật một page). Hàm thuần — có test.
const { B, I } = require("./zalo_text");
const { normalizePageName, pageOfCampaign, creditedCampaignOwner, DISPLAY, campaignMarket, isTestCampaign } = require("./rules");

const fmt = (n) => Number(n || 0).toLocaleString("vi-VN");
const p1 = (x) => Number(x || 0).toFixed(1).replace(".", ",");
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const compactMoney = (n) => {
    const x = Number(n || 0);
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}tr`;
    if (x >= 1_000) return `${Math.round(x / 1_000)}k`;
    return `${Math.round(x)}đ`;
};
// Chủ camp sau khi chuyển số lấn nước (Sỹ Anh chốt 10/10/2026) — cùng luật Sheet.
const ownerLabel = (cn) => { const k = creditedCampaignOwner(cn); return k ? DISPLAY[k] || k : null; };

// ── Chi tiết từng camp dưới mỗi page (Sỹ Anh yêu cầu 12/10/2026: "lấy thông số để tối ưu camp") ──
// Ở Nhật Meta không báo mess, Pancake không ghi hội thoại đến từ ad nào (ad_clicks rỗng), đơn POS
// không có ad_id. Số theo camp nên là: tiền + click vào Messenger (inline_link_clicks) + đơn Meta
// tự ghi theo ad (messaging_order_created — 12/10 khớp POS, 10/10 Meta 9 / POS 19 nên chỉ để SO
// camp với nhau). Mess của page CHỈ chia cho camp khi page chạy nhiều camp — chia theo click.

/** "JAPAN/ANH/PHI/Birstone/Veloura Collection Gold/10-10" → "PHI/Birstone/10-10": bỏ ô nước,
 *  marketer và page (page đã in ở dòng trên) — đủ để tìm camp trên Ads Manager. */
function campaignLabel(cn) {
    const p = String(cn || "").split("/").map((s) => s.trim());
    const t = pageOfCampaign(cn);
    const k = t ? p.indexOf(t) : -1;
    if (k < 2) return String(cn || "");
    return [...p.slice(k - 2, k), ...p.slice(k + 1)].filter(Boolean).join("/") || String(cn);
}

/** Tên nhóm quảng cáo gọn: nhóm đặt tên kiểu camp ("JP/THANG/…/12-10 VD2 - Bản sao") lấy ô cuối. */
function adsetLabel(s) {
    const x = String(s || "").split("/").pop().trim() || String(s || "") || "(không tên)";
    return x.length > 40 ? x.slice(0, 40) + "…" : x;
}

/** Mess của page chia cho các camp của page theo click Messenger (không có click thì theo tiền).
 *  Phần dư làm tròn trao cho camp có phần lẻ lớn nhất — tổng luôn đúng bằng mess của page. */
function splitMessByCampaign(totalMess, cs) {
    if (cs.length <= 1) return cs.map(() => totalMess);
    let w = cs.map((c) => Number(c.link_clicks || 0));
    if (!w.some((v) => v > 0)) w = cs.map((c) => Number(c.spend_vnd || 0));
    const S = w.reduce((a, b) => a + b, 0) || 1;
    const raw = w.map((v) => (totalMess * v) / S);
    const out = raw.map(Math.floor);
    const remainders = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
    for (let j = 0, leftover = totalMess - out.reduce((a, b) => a + b, 0); j < leftover; j++) out[remainders[j % remainders.length][1]]++;
    return out;
}

/** Gom ad của camp theo nhóm quảng cáo (adset), xếp theo tiền. */
function adsetsOfCampaign(c) {
    const m = new Map();
    for (const a of c.ads || []) {
        if (!(a.spend_vnd > 0)) continue;
        const k = a.adset_name || "";
        if (!m.has(k)) m.set(k, { ten: adsetLabel(k), ads: 0, hien: 0, click: 0, don: 0 });
        const g = m.get(k);
        g.ads += a.spend_vnd; g.hien += Number(a.impressions || 0); g.click += Number(a.link_clicks || 0); g.don += Number(a.purchases || 0);
    }
    return [...m.values()].sort((a, b) => b.ads - a.ads);
}

/** "74 click · 12k/click · CTR 4,9%" — CTR tính trên click Messenger, không phải mọi lượt bấm. */
function clickStats(ads, click, impressions) {
    const o = [`${fmt(click)} click`];
    if (click > 0) o.push(`${compactMoney(ads / click)}/click`);
    if (impressions > 0) o.push(`CTR ${p1((click / impressions) * 100)}%`);
    return o;
}
const MAX_ADSETS = 4;

/**
 * Ghép camp (Meta) + page (Pancake) + đơn (POS) theo tên page đã chuẩn hoá.
 * @param pk    kết quả /api/talpha/pancake-messages
 * @param camps campaigns của /api/talpha/realtime (mọi nước — lọc ở đây theo pk.key)
 * @returns { trang: [...], tong, khongRo }
 */
function mergeByPage(pk, camps) {
    const map = new Map();
    const pageRow = (name) => {
        const k = normalizePageName(name);
        if (!map.has(k)) map.set(k, { ten: name, nv: null, ads: 0, mess: 0, cmt: 0, sdt: 0, don: 0, dsLocal: 0, dsVnd: 0, camps: [], cs: [], loi: "" });
        return map.get(k);
    };
    for (const p of (pk && pk.pages) || []) {
        const x = pageRow(p.name);
        x.ten = p.name; x.nv = p.nv || x.nv;
        x.mess += Number(p.inbox_moi || 0); x.cmt += Number(p.comment_moi || 0); x.sdt += Number(p.co_sdt || 0);
        if (p.loi) x.loi = p.loi;
    }
    for (const c of camps || []) {
        if (!(c.spend_vnd > 0) || isTestCampaign(c.campaign_name) || campaignMarket(c.campaign_name).market !== pk.key) continue;
        const t = pageOfCampaign(c.campaign_name) || "(camp không ghi page)";
        const x = pageRow(t);
        x.ads += c.spend_vnd; x.camps.push(c.campaign_name); x.cs.push(c);
        x.nv = ownerLabel(c.campaign_name) || x.nv;
    }
    const unattributed = { don: 0, dsLocal: 0, dsVnd: 0 };
    for (const d of (pk && pk.don) || []) {
        if (!d.page_name) { unattributed.don += d.don; unattributed.dsLocal += d.ds_local; unattributed.dsVnd += d.ds_vnd; continue; }
        const x = pageRow(d.page_name);
        x.don += d.don; x.dsLocal += d.ds_local; x.dsVnd += d.ds_vnd;
    }
    const pages = [...map.values()].filter((x) => x.ads > 0 || x.mess > 0 || x.cmt > 0 || x.don > 0 || x.loi)
        .sort((a, b) => b.ads - a.ads || b.mess - a.mess || b.don - a.don);
    const totals = { ads: 0, mess: 0, cmt: 0, sdt: 0, don: unattributed.don, dsLocal: unattributed.dsLocal, dsVnd: unattributed.dsVnd };
    for (const x of pages) {
        totals.ads += x.ads; totals.mess += x.mess; totals.cmt += x.cmt; totals.sdt += x.sdt;
        totals.don += x.don; totals.dsLocal += x.dsLocal; totals.dsVnd += x.dsVnd;
    }
    totals.ads = Math.round(totals.ads);
    return { trang: pages, tong: totals, khongRo: unattributed };
}

/**
 * Số tin nhắn thay cho Meta trong bản tin thường (08:30 · 13:00 · 18:00 · 22:00) của nước dùng
 * Pancake: tổng, theo người (chủ page), theo camp (tin nhắn của page dồn cho camp TIÊU NHIỀU NHẤT
 * trên page đó — hội thoại không ghi đến từ camp nào).
 */
function messFromPancake(pk, camps) {
    if (!pk || !pk.pancake || !pk.pancake.ok) return null;
    const { trang: pages, tong: totals } = mergeByPage(pk, camps);
    const byMarketer = {}, byCampaign = {};
    for (const x of pages) {
        if (x.nv) byMarketer[x.nv] = (byMarketer[x.nv] || 0) + x.mess;
        const top = (camps || []).filter((c) => x.camps.includes(c.campaign_name)).sort((a, b) => b.spend_vnd - a.spend_vnd)[0];
        if (top) byCampaign[top.campaign_name] = (byCampaign[top.campaign_name] || 0) + x.mess;
    }
    return { tong: totals.mess, theoNguoi: byMarketer, theoCamp: byCampaign };
}

const formatLocalAmount = (local, vnd, sym) => (local > 0 ? `${fmt(local)}${sym} ≈ ${compactMoney(vnd)}` : "0");

/**
 * @param o { n: NUOC[m], ngay, gio "15:05", pk, camps, truoc: {ngay, tong} | null, loiCamp }
 * @returns { text, tong }
 */
function buildHourlyDigest({ n, ngay: date, gio: time, pk, camps, truoc: previous, loiCamp: campError }) {
    const sym = (pk && pk.symbol) || "";
    const { trang: pages, tong: totals, khongRo: unattributed } = mergeByPage(pk || { pages: [], don: [], key: n.key }, campError ? [] : camps);
    const lines = [B(`⏰ ${n.flag} ${n.ten.toUpperCase()} · ${time} · HÔM NAY ${ddmm(date)}`)];
    lines.push(I("Tin nhắn đếm từ Pancake (Meta không báo mess ở Nhật) · đơn từ POS · ads Meta trực tiếp"));
    const pancakeError = !pk ? "chưa lấy được số Pancake + đơn lúc này" : !pk.pancake.ok ? `Pancake lỗi: ${pk.pancake.loi}` : "";
    if (pancakeError) lines.push(`⚠️ ${B(pancakeError)} — số tin nhắn dưới đây chưa đủ.`);
    if (campError) lines.push(`⚠️ ${I(`chưa lấy được tiền ads từ Meta (${campError})`)}`);
    const expiresAt = pk && pk.pancake && pk.pancake.het_han ? Date.parse(pk.pancake.het_han) : null;
    if (expiresAt && expiresAt - Date.now() < 14 * 86400_000) lines.push(`⚠️ ${B(`Token Pancake hết hạn ${ddmm(new Date(expiresAt + 7 * 3600_000).toISOString().slice(0, 10))}`)} — gửi token mới cho kỹ thuật.`);
    lines.push("");

    const prevTotals = previous && previous.ngay === date ? previous.tong : null;
    const deltaText = (k) => (prevTotals && totals[k] - (prevTotals[k] || 0) > 0 ? ` (+${fmt(totals[k] - (prevTotals[k] || 0))})` : "");
    lines.push(`💰 Ads ${B(fmt(totals.ads) + "đ")} · 💬 ${B(fmt(totals.mess) + " mess")}${deltaText("mess")}`
        + (totals.mess > 0 ? ` · ${B(compactMoney(totals.ads / totals.mess) + "/mess")}` : "")
        + (totals.cmt ? ` · ${fmt(totals.cmt)} bình luận` : ""));
    lines.push(`🛒 ${B(fmt(totals.don) + " đơn")}${deltaText("don")} · DS ${B(formatLocalAmount(totals.dsLocal, totals.dsVnd, sym))}`
        + (totals.don > 0 ? ` · ${compactMoney(totals.ads / totals.don)}/đơn` : "")
        + (totals.mess > 0 ? ` · chốt ${p1((totals.don / totals.mess) * 100)}%` : "")
        + (totals.dsVnd > 0 ? ` · %ads ${p1((totals.ads / totals.dsVnd) * 100)}%` : ""));
    if (totals.sdt) lines.push(`📞 ${fmt(totals.sdt)} khách mới đã để SĐT`);
    if (prevTotals) lines.push(I(`(+…) = thêm trong giờ qua`));

    // Số từng page/camp lần này — nhớ lại (state.gioTruoc) để giờ sau in phần tăng.
    totals.trang = {}; totals.camp = {};
    const prevPages = (prevTotals && prevTotals.trang) || {}, prevCamps = (prevTotals && prevTotals.camp) || {};
    const increase = (current, old) => (prevTotals && old != null && current - old > 0 ? current - old : 0);
    let hasCamps = false, anyClicks = false;
    const estimateBases = new Set();   // page nhiều camp: mess chia theo "click" hay "tiền"

    if (pages.length) lines.push("", B("📄 THEO PAGE · CAMP"));
    for (const x of pages) {
        const pageKey = normalizePageName(x.ten), old = prevPages[pageKey] || {};
        totals.trang[pageKey] = { mess: x.mess, don: x.don };
        const messDelta = increase(x.mess, old.mess), orderDelta = increase(x.don, old.don);
        lines.push(`${B(x.ten)}${x.nv ? ` — ${x.nv}` : ""}`);
        const stats = [`ads ${compactMoney(x.ads)}`, `${fmt(x.mess)} mess${messDelta ? ` (+${fmt(messDelta)})` : ""}`];
        if (x.mess > 0 && x.ads > 0) stats.push(`${compactMoney(x.ads / x.mess)}/mess`);
        if (x.cmt) stats.push(`${fmt(x.cmt)} bình luận`);
        if (x.sdt) stats.push(`${fmt(x.sdt)} SĐT`);
        stats.push(`${fmt(x.don)} đơn${orderDelta ? ` (+${fmt(orderDelta)})` : ""}`);
        if (x.don) stats.push(formatLocalAmount(x.dsLocal, x.dsVnd, sym));
        if (x.don && x.ads > 0) stats.push(`${compactMoney(x.ads / x.don)}/đơn`);
        lines.push(`    ${stats.join(" · ")}`);
        if (x.loi) lines.push(`    ⚠️ ${I(x.loi)}`);

        // Từng camp của page: tiền (+giờ qua) · mess (chia theo click nếu page nhiều camp) ·
        // đơn Meta · click Messenger · CTR · CPM; camp nhiều nhóm thì thêm từng nhóm.
        const cs = [...x.cs].sort((a, b) => b.spend_vnd - a.spend_vnd);
        const hasClicks = cs.some((c) => c.link_clicks != null);
        if (hasClicks) anyClicks = true;
        const messPerCamp = splitMessByCampaign(x.mess, cs);
        cs.forEach((c, i) => {
            hasCamps = true;
            const impressions = Number(c.impressions || 0), click = Number(c.link_clicks || 0), metaOrders = Number(c.purchases || 0);
            const id = c.campaign_id || c.campaign_name;
            const oldCamp = prevCamps[id] || {};
            totals.camp[id] = { ads: Math.round(c.spend_vnd), click };
            const adsDelta = increase(Math.round(c.spend_vnd), oldCamp.ads);
            const estimated = cs.length > 1;
            if (estimated && x.mess > 0) estimateBases.add(hasClicks && cs.some((c) => c.link_clicks > 0) ? "click" : "tiền");
            const owner = ownerLabel(c.campaign_name);
            lines.push(`  ▸ ${B(campaignLabel(c.campaign_name))}${c.account_name ? ` · ${c.account_name}` : ""}${owner && owner !== x.nv ? ` — ${owner}` : ""}`);
            const d1 = [`ads ${compactMoney(c.spend_vnd)}${adsDelta ? ` (+${compactMoney(adsDelta)})` : ""}`];
            if (x.mess > 0) {
                const m = messPerCamp[i];
                d1.push(`${estimated ? "~" : ""}${fmt(m)} mess`);
                if (m > 0) d1.push(`${compactMoney(c.spend_vnd / m)}/mess`);
            }
            d1.push(`${fmt(metaOrders)} đơn Meta`);
            if (metaOrders > 0) d1.push(`${compactMoney(c.spend_vnd / metaOrders)}/đơn`);
            lines.push(`      ${d1.join(" · ")}`);
            const d2 = hasClicks ? clickStats(c.spend_vnd, click, impressions) : [];
            if (impressions > 0) d2.push(`CPM ${compactMoney((c.spend_vnd / impressions) * 1000)}`);
            if (d2.length) lines.push(`      ${d2.join(" · ")}`);

            const adsets = adsetsOfCampaign(c);
            if (adsets.length < 2) return;
            for (const g of adsets.slice(0, MAX_ADSETS)) {
                const o = [compactMoney(g.ads)];
                if (hasClicks) o.push(...clickStats(g.ads, g.click, g.hien));
                if (g.don) o.push(`${fmt(g.don)} đơn`);
                lines.push(`      • ${g.ten}: ${o.join(" · ")}`);
            }
            const rest = adsets.slice(MAX_ADSETS);
            if (rest.length) lines.push(`      • +${rest.length} nhóm khác: ${compactMoney(rest.reduce((s, g) => s + g.ads, 0))}`);
        });
    }
    if (hasCamps) lines.push(I(["Camp:", anyClicks ? "click = bấm vào Messenger ·" : "",
        "đơn Meta = đơn Meta tự ghi theo ad (có lúc thiếu so với POS)",
        estimateBases.size ? `· ~mess = page chạy nhiều camp, chia mess theo ${[...estimateBases].join("/")}` : ""].filter(Boolean).join(" ")));
    if (unattributed.don) lines.push(`📍 Đơn không ghi page: ${fmt(unattributed.don)} đơn · ${formatLocalAmount(unattributed.dsLocal, unattributed.dsVnd, sym)}`);
    if (!pages.length && !unattributed.don) lines.push("", I("(hôm nay chưa có tiền ads, tin nhắn hay đơn nào)"));
    return { text: lines.join("\n"), tong: totals };
}

module.exports = { mergeByPage, messFromPancake, buildHourlyDigest, campaignLabel, adsetLabel, splitMessByCampaign };
