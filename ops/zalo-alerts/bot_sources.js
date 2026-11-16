// Nguồn số bot.js hỏi dashboard (tách 16/11/2026): tuổi sync, bản số theo nước, realtime (Meta +
// POS live, dùng chung một lượt cho mọi nước của một mốc), tin nhắn Pancake theo page.
const CFG = require("./config");
const { MARKETS, pageOfCampaign, campaignMarket } = require("./rules");
const { DR, HOURLY_CFG, log } = require("./bot_config");

// Tuổi của số trong Sheet (/api/talpha/sync-health). Hỏng thì null → tin gửi không kèm
// cảnh báo: thà thiếu cảnh báo còn hơn chặn mất báo cáo.
async function fetchStale() {
    if (!CFG.syncHealthUrl) return null;
    try {
        const res = await fetch(CFG.syncHealthUrl, { headers: { "cache-control": "no-store" } });
        if (!res.ok) return null;
        const j = await res.json();
        const okAge = j.last_ok_age_minutes == null ? null : Number(j.last_ok_age_minutes);
        if (!Number.isFinite(okAge)) return null;
        // loi = tên TKQC/shop đọc lỗi trong vòng sync gần nhất → tin "SỐ CHƯA ĐỦ" nói đích danh.
        // healthCheck = bộ soát từng TKQC/shop: tuổi lượt gần nhất + mục mất sạch / tụt dòng. stalledShops = nước
        // ads còn tiêu mà shop POS không có đơn mới nhiều ngày (12/11/2026).
        const acc = j.accounts || null;
        return { okAge, limit: Number(DR.staleWarnMinutes || 120), lastOkTs: Date.now() - okAge * 60000, loi: j.fetch_errors || null,
            healthCheck: {
                ageMinutes: acc && acc.age_minutes != null ? Number(acc.age_minutes) : null,
                limit: Number(j.health_check_stale_minutes || 180),
                failing: ((acc && acc.failing) || []).filter((x) => x.status === "empty" || x.status === "drop"),
            },
            stalledShops: j.stalled_shops || [] };
    } catch (e) { log("Đọc tuổi sync lỗi:", e.message); return null; }
}

// Bảng số theo nước × người của một tháng — format_all.py ghi mỗi giờ vào bảng
// market_monthly_reports (15/11/2026, trước đó file data/bao_cao_nuoc); bot hỏi qua dashboard mỗi lần.
async function readMonthlyReport(month) {
    try {
        const r = await fetch(`${CFG.dashboardBaseUrl}/api/talpha/market-report?month=${encodeURIComponent(month)}`,
            { signal: AbortSignal.timeout(30_000) });
        return r.ok ? await r.json() : null;
    } catch (e) {
        log("Đọc bản số theo nước lỗi:", e.message);
        return null;
    }
}

// /api/talpha/realtime hỏi thẳng Meta + POS live (chậm, có rate-limit): bốn nước của CÙNG một
// mốc dùng chung một lượt gọi. Giữ 3 phút; lượt hỏng thì bỏ khỏi bộ nhớ để lần sau gọi lại.
const REALTIME_CACHE_MS = 3 * 60 * 1000;
const realtimeCache = new Map();
function getRealtime(dateStr) {
    const hit = realtimeCache.get(dateStr);
    if (hit && Date.now() - hit.at < REALTIME_CACHE_MS) return hit.p;
    const p = (async () => {
        const res = await fetch(`${DR.realtimeUrl}?from_date=${dateStr}&to_date=${dateStr}`, { headers: { "cache-control": "no-store" } });
        if (!res.ok) throw new Error(`realtime HTTP ${res.status}`);
        return res.json();
    })();
    realtimeCache.set(dateStr, { at: Date.now(), p });
    p.catch(() => { if (realtimeCache.get(dateStr) && realtimeCache.get(dateStr).p === p) realtimeCache.delete(dateStr); });
    return p;
}

// Tin nhắn Pancake + đơn POS theo page của một nước một ngày (/api/talpha/pancake-messages). camps:
// campaign Meta cùng ngày — gửi kèm tên page của camp nước đó (camp tạo hôm nay chưa kịp sync).
async function fetchPancakeMarket(m, date, camps) {
    if (!HOURLY_CFG.url) throw new Error("thiếu moiGio.url trong config");
    const pages = [...new Set((camps || [])
        .filter((c) => campaignMarket(c.campaign_name).market === MARKETS[m].key)
        .map((c) => pageOfCampaign(c.campaign_name)).filter(Boolean))];
    const q = new URLSearchParams({ market: m, date: date, ...(pages.length ? { trang: pages.join("|") } : {}) });
    const res = await fetch(`${HOURLY_CFG.url}?${q}`, { headers: { "cache-control": "no-store" } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || `pancake-messages HTTP ${res.status}`);
    return j;
}

module.exports = { fetchStale, readMonthlyReport, getRealtime, fetchPancakeMarket };
