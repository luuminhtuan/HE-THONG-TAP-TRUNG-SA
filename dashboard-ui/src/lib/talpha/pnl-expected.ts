// Doanh thu + giá vốn DỰ KIẾN theo tỉ lệ giao thành công từng nước — dùng chung tab P&L và
// tab Tổng quan để hai tab ra MỘT con số lãi (11/11/2026, Sỹ Anh: "không đúng thực tế vì thiếu
// tỉ lệ giao thành công"). Hàm thuần, chạy ở trình duyệt.
//
//   Doanh thu dự kiến = doanh số × tỉ lệ giao của nước (r từ /api/talpha/pnl-costs?delivery_rate=1 —
//   cùng thước Kế toán → Lãi lỗ). Phần doanh số ngoài tab nước / nước chưa đo được r → lấy r
//   bình quân (trọng số doanh số); không có nước nào đo được → coi giao hết (r = 1).
//   Phí ship: đơn hoàn vẫn mất → không động tới.
//   Giá vốn: nước trong restock_markets (UAE — hàng về kho D&T bán tiếp) chỉ mất phần giao được;
//   nước khác mất cả giá vốn đơn hoàn.

export type MarketDaySales = { code: string; date: string; doanh_so: number };
export type MarketDayCogs = { code: string; date: string; cogs_vnd: number };
/** Tỉ lệ giao một nước — khuôn DeliveryRate (lib/talpha/income-statement.ts) + lỗi đọc kiện nếu có. */
export type MarketDeliveryRate = {
    r: number | null; giao?: number; hoan?: number; tu?: string | null; den?: string | null; tam?: boolean; error?: string;
};

export type ExpectedInput = {
    markets: { code: string | null; doanh_so: number }[];
    days: { date: string; doanh_so: number }[];
    market_days?: MarketDaySales[];
    cost_days?: { date: string; cogs_vnd: number }[];
    cost_market_days?: MarketDayCogs[];
    delivery_rates?: Record<string, MarketDeliveryRate>;
    restock_markets?: string[];
};

export type ExpectedPnl = {
    /** r bình quân theo doanh số các nước đo được — null nếu không nước nào đo được. */
    avgRate: number | null;
    /** r áp cho một nước (đo được → của nó; không → bình quân; không có gì → 1). */
    rateFor: (code: string | null | undefined) => number;
    cogsAfterReturns: (code: string, cogsVnd: number) => number;
    byDay: Map<string, { revenue: number; cogs: number }>;
    revenue: number; cogs: number;
    /** revenue ÷ doanh số cả kỳ. */
    periodRate: number | null;
    /** Nước có doanh số mà chưa đo được tỉ lệ giao. */
    marketsMissingRate: string[];
};

export function expectedByDeliveryRate(n: ExpectedInput): ExpectedPnl {
    const rates = n.delivery_rates || {};
    const restock = new Set(n.restock_markets || []);
    const measured = (code: string | null | undefined): number | null => (code ? rates[code]?.r ?? null : null);
    const withRate = n.markets.filter((m) => measured(m.code) != null);
    const salesWithRate = withRate.reduce((s, m) => s + m.doanh_so, 0);
    const avgRate = salesWithRate > 0 ? withRate.reduce((s, m) => s + m.doanh_so * measured(m.code)!, 0) / salesWithRate : null;
    const rateFor = (code: string | null | undefined) => measured(code) ?? avgRate ?? 1;
    const cogsAfterReturns = (code: string, cogsVnd: number) => (restock.has(code) ? cogsVnd * rateFor(code) : cogsVnd);

    const marketSalesByDay = new Map<string, { sales: number; revenue: number }>();
    for (const d of n.market_days || []) {
        const x = marketSalesByDay.get(d.date) || { sales: 0, revenue: 0 };
        x.sales += d.doanh_so; x.revenue += d.doanh_so * rateFor(d.code);
        marketSalesByDay.set(d.date, x);
    }
    const cogsSaved = new Map<string, number>();
    for (const d of n.cost_market_days || []) {
        const saved = d.cogs_vnd - cogsAfterReturns(d.code, d.cogs_vnd);
        if (saved) cogsSaved.set(d.date, (cogsSaved.get(d.date) || 0) + saved);
    }
    const cogsByDay = new Map((n.cost_days || []).map((d) => [d.date, d.cogs_vnd]));

    const byDay = new Map<string, { revenue: number; cogs: number }>();
    const dates = new Set([...n.days.map((d) => d.date), ...cogsByDay.keys()]);
    const salesByDay = new Map(n.days.map((d) => [d.date, d.doanh_so]));
    let revenue = 0, cogs = 0, sales = 0;
    for (const date of dates) {
        const daySales = salesByDay.get(date) || 0;
        const x = marketSalesByDay.get(date) || { sales: 0, revenue: 0 };
        const dayRevenue = x.revenue + Math.max(0, daySales - x.sales) * (avgRate ?? 1);
        const dayCogs = (cogsByDay.get(date) || 0) - (cogsSaved.get(date) || 0);
        byDay.set(date, { revenue: dayRevenue, cogs: dayCogs });
        revenue += dayRevenue; cogs += dayCogs; sales += daySales;
    }
    return {
        avgRate, rateFor, cogsAfterReturns, byDay, revenue, cogs,
        periodRate: sales > 0 ? revenue / sales : null,
        marketsMissingRate: n.markets.filter((m) => m.code && m.doanh_so > 0 && measured(m.code) == null).map((m) => m.code!),
    };
}
