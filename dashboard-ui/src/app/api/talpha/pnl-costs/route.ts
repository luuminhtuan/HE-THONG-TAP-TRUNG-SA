import { NextRequest, NextResponse } from "next/server";
import { COST_RATE_RMB_VND, MARKETS_PUBLIC, REPORT_START_DATE } from "@/lib/talpha/rules";
import { computeDeliveryRate } from "@/lib/talpha/income-statement";
import { DELIVERY_RATE_CFG, INCOME_RULES, loadMarketParcels } from "@/lib/talpha/income-statement-sources";
import { todayVn } from "@/lib/talpha/order-ledger";
import type { MarketDeliveryRate } from "@/lib/talpha/pnl-expected";
import { computeOrderCosts, type OrderCost } from "@/lib/talpha/order-costs";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Chi phí cho tab P&L và Tổng quan: GIÁ VỐN và PHÍ SHIP của mọi đơn đã chốt, theo ngày và
// theo nước. Doanh số, tiền ads, số đơn hai tab lấy từ file TỔNG TEAM (sheet-report) — route
// này chỉ thêm hai khoản Sheet không có. Cách tính nằm ở lib/talpha/order-costs.ts, dùng chung
// với tab P&L theo SP (/api/talpha/product-pnl).
//
// ?delivery_rate=1 (tab P&L + Tổng quan, 11/11/2026): thêm TỈ LỆ GIAO THÀNH CÔNG từng nước — cùng
// thước với Kế toán → Lãi lỗ (lib/talpha/income-statement.ts → computeDeliveryRate, đo theo tiền COD
// trên kiện đã có kết quả lên đơn 90→21 ngày trước). Hai tab nhân doanh số với tỉ lệ này ra doanh
// thu dự kiến (lib/talpha/pnl-expected.ts).
export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const fromIn = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;

    // Phân quyền theo team: chỉ đơn của nước người xem được (proxy.ts đã chặn người chưa đăng nhập).
    const a = await getAccess(req);
    const restricted = !a || !seesAllMarkets(a);

    try {
        const { don: orders, thieu: missingCosts, ship_basis } = await computeOrderCosts(from, to, restricted ? (shop) => !!a && canMarket(a, shop) : undefined);

        type Bucket = { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number };
        const emptyBucket = (): Bucket => ({ orders: 0, cogs_vnd: 0, orders_cogs_full: 0, ship_vnd: 0, orders_no_ship: 0 });
        const addOrder = (b: Bucket, o: OrderCost) => {
            b.orders += 1;
            b.cogs_vnd += o.cogs;
            if (o.du) b.orders_cogs_full += 1;
            if (o.ship === null) b.orders_no_ship += 1; else b.ship_vnd += o.ship;
        };
        const total = emptyBucket();
        const byDay = new Map<string, Bucket>();
        const byMarket = new Map<string, Bucket>();
        const byMarketDay = new Map<string, Bucket>();
        for (const o of orders) {
            addOrder(total, o);
            const n = byDay.get(o.d) || emptyBucket(); addOrder(n, o); byDay.set(o.d, n);
            const m = byMarket.get(o.shop) || emptyBucket(); addOrder(m, o); byMarket.set(o.shop, m);
            const k = `${o.shop}|${o.d}`;
            const md = byMarketDay.get(k) || emptyBucket(); addOrder(md, o); byMarketDay.set(k, md);
        }

        // Tỉ lệ giao từng nước đang bán mà người xem được. Nước nào đọc kiện lỗi thì để null +
        // ghi lỗi — giao diện báo ra, không bịa tỉ lệ.
        let delivery_rates: Record<string, MarketDeliveryRate> | undefined;
        if (sp.get("delivery_rate") === "1") {
            const today = todayVn();
            const asOf = to < today ? to : today;
            const visible = MARKETS_PUBLIC.markets
                .filter((m) => m.status === "active" && (!restricted || (!!a && canMarket(a, m.code))));
            delivery_rates = Object.fromEntries(await Promise.all(visible.map(async (m): Promise<[string, MarketDeliveryRate]> => {
                try {
                    const src = await loadMarketParcels(m.code, from, to, asOf);
                    return [m.code, computeDeliveryRate(src.kien, asOf, DELIVERY_RATE_CFG)];
                } catch (e: any) {
                    console.error(`pnl-costs delivery_rate ${m.code}:`, e?.message || e);
                    return [m.code, { r: null, error: e?.message || String(e) }];
                }
            })));
        }

        return NextResponse.json({
            from, to,
            total: total,
            days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b })),
            markets: [...byMarket.entries()].map(([code, b]) => ({
                code, ...b,
                ship_per_order_vnd: b.orders > b.orders_no_ship ? b.ship_vnd / (b.orders - b.orders_no_ship) : null,
            })),
            market_days: [...byMarketDay.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, b]) => {
                const [code, date] = k.split("|");
                return { code, date, ...b };
            }),
            delivery_rates,
            // Nước mà hàng hoàn quay về kho bán tiếp → đơn hoàn KHÔNG mất giá vốn (UAE — kho D&T).
            restock_markets: (INCOME_RULES.returns?.restock_markets || ["AE"]).map((x) => x.toUpperCase()),
            ship_basis,
            missing_costs: missingCosts,
            cost_rate_rmb_vnd: COST_RATE_RMB_VND,
        });
    } catch (e: any) {
        console.error("pnl-costs:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
