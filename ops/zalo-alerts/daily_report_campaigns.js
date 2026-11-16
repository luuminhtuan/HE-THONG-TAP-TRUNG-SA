// Phần CHI TIẾT CAMP theo marketer ở cuối tin ADS (tách từ daily_report.js 16/11/2026) — dùng chung
// cho tin gộp mọi nước và tin một nước. Hàm thuần.
const { B, I } = require("./zalo_text");
const { fmt, pct, compactMoney, marketerOf } = require("./daily_report_common");

// Nhãn một camp: 🔴 đốt tiền (luật cũ, giữ nguyên) · 🟢 ngon · 🟡 có đơn · ⚪ chưa ra đơn.
function campaignBadge(c, cfg) {
    const orders = c.orders || 0;
    if (c.spend_vnd >= (cfg.recWasteSpend || 300000) && orders === 0) return "🔴";
    if (orders >= 3 && c.revenue_vnd > 0 && pct(c.spend_vnd, c.revenue_vnd) < (cfg.recGoodAdsPct || 20)) return "🟢";
    return orders > 0 ? "🟡" : "⚪";
}

// ── Chi tiết camp theo marketer — nối vào cuối các dòng đầu tin rồi trả cả tin ──
// opts.khongDon: nước chưa nối shop POS (Nhật lúc mở) — không có đơn để chấm camp, nên không
// gắn 🔴 "đốt tiền" (mọi camp đều 0 đơn), chỉ in tiền + tin nhắn + giá mỗi tin.
function appendCampaignDetails(lines, { camps, cfg, canhBaoCamp: campaignError, opts }) {
    lines.push("", B(opts.intraday ? "📋 CHI TIẾT CAMP HÔM NAY" : "📋 CHI TIẾT CAMP"));
    if (campaignError) {
        lines.push(I("(chưa lấy được chi tiết camp lúc này — số tổng ở trên vẫn đúng theo Sheet)"));
    } else if (!camps.length) {
        lines.push(I("(không có camp nào tiêu tiền)"));
    } else if (opts.khongDon) {
        const groups = new Map();
        for (const c of camps) {
            const mk = marketerOf(c.campaign_name, !!opts.camNuoc) || "Chưa gán";
            if (!groups.has(mk)) groups.set(mk, []);
            groups.get(mk).push(c);
        }
        const sumSpend = (xs) => xs.reduce((n, c) => n + (c.spend_vnd || 0), 0);
        for (const [mk, xs] of [...groups].sort((a, b) => (a[0] === "Chưa gán") - (b[0] === "Chưa gán") || sumSpend(b[1]) - sumSpend(a[1]))) {
            xs.sort((a, b) => b.spend_vnd - a.spend_vnd);
            lines.push("", `${B(`👤 ${mk}`)} · ${xs.length} camp · ads ${compactMoney(sumSpend(xs))}`);
            for (const c of xs) {
                const mess = c.messages || 0;
                lines.push(`• ${String(c.campaign_name || "").trim()}`,
                    `    ${[compactMoney(c.spend_vnd), `${fmt(mess)} mess`, ...(mess > 0 ? [`${compactMoney(c.spend_vnd / mess)}/mess`] : [])].join(" · ")}`);
            }
        }
    } else {
        lines.push(I("🟢 ngon · 🟡 có đơn · ⚪ chưa ra đơn · 🔴 đốt tiền"));
        const groups = new Map();
        for (const c of camps) {
            const mk = marketerOf(c.campaign_name, !!opts.camNuoc) || "Chưa gán";
            if (!groups.has(mk)) groups.set(mk, []);
            groups.get(mk).push(c);
        }
        const sumSpend = (xs) => xs.reduce((n, c) => n + (c.spend_vnd || 0), 0);
        const ordered = [...groups].sort((a, b) => (a[0] === "Chưa gán") - (b[0] === "Chưa gán") || sumSpend(b[1]) - sumSpend(a[1]));
        for (const [mk, xs] of ordered) {
            xs.sort((a, b) => b.spend_vnd - a.spend_vnd);
            lines.push("", `${B(`👤 ${mk}`)} · ${xs.length} camp · ads ${compactMoney(sumSpend(xs))}`);
            for (const c of xs) {
                const orders = c.orders || 0, mess = c.messages || 0;
                const stats = [compactMoney(c.spend_vnd), `${fmt(mess)} mess`, `${fmt(orders)} đơn`];
                if (orders > 0 && mess > 0) stats.push(`chốt ${Math.round(pct(orders, mess))}%`);
                if (c.revenue_vnd > 0) stats.push(`%ads ${Math.round(pct(c.spend_vnd, c.revenue_vnd))}%`);
                lines.push(`${campaignBadge(c, cfg)} ${String(c.campaign_name || "").trim()}`, `    ${stats.join(" · ")}`);
            }
        }
        lines.push("", I("Đơn trong chi tiết camp gán theo quảng cáo nên có thể khác số đầu tin (đầu tin gán theo tag POS, khớp Sheet)."));
    }
    return lines.join("\n");
}

module.exports = { campaignBadge, appendCampaignDetails };
