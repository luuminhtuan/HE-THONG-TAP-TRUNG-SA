/**
 * Shop "đứng im": ads của nước vẫn tiêu mà shop POS của nước đó không có đơn mới nhiều ngày.
 *
 * Vì sao cần (12/11/2026): bộ soát theo từng shop chỉ kêu khi số dòng về 0 hoặc tụt mạnh. Shop
 * hỏng khoá API / đổi shop thì đơn cũ vẫn nguyên, không có đơn mới — mọi chốt đều báo "ổn".
 * Chỉ kêu khi ads CÒN TIÊU: nước đang nghỉ (không chạy quảng cáo) không có đơn là đúng, kêu là
 * spam nhóm. Ngưỡng nằm ở config/talpha_rules.json → thresholds (stalled_shop_days, stalled_shop_min_ads_vnd).
 * Route /api/talpha/sync-health trả danh sách này (stalled_shops); bot Zalo in vào bản tin nhóm nước.
 */
export type StalledShop = { shop: string; last_order_date: string | null; days: number | null; ads_vnd: number };

const DAY_MS = 86400000;

/**
 * shops          — mã shop của các nước đang bán (TW, SG…)
 * lastOrderDate  — mã shop → ngày tạo đơn mới nhất "YYYY-MM-DD" (không có = chưa từng có đơn)
 * adsByShop      — mã shop → tiền ads (VND) của `days` ngày trọn gần nhất
 * today          — "YYYY-MM-DD" giờ VN
 */
export function findStalledShops(
    shops: string[], lastOrderDate: Record<string, string | null | undefined>,
    adsByShop: Record<string, number>, today: string,
    { days = 3, minAds = 500000 }: { days?: number; minAds?: number } = {},
): StalledShop[] {
    const todayTs = Date.parse(`${today}T00:00:00Z`);
    const out: StalledShop[] = [];
    for (const shop of shops) {
        const ads = Math.round(Number(adsByShop[shop] || 0));
        if (!(ads >= minAds)) continue;
        const d = String(lastOrderDate[shop] || "").slice(0, 10);
        const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
        const idleDays = Number.isFinite(t) && Number.isFinite(todayTs) ? Math.round((todayTs - t) / DAY_MS) : null;
        if (idleDays != null && idleDays < days) continue;
        out.push({ shop, last_order_date: Number.isFinite(t) ? d : null, days: idleDays, ads_vnd: ads });
    }
    return out;
}
