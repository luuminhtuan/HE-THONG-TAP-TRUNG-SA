import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { RULES, REPORT_START_DATE, campaignMarket, parseCampaign, parseProductCode } from "@/lib/talpha/rules";
import { computeOrderCosts } from "@/lib/talpha/order-costs";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════
// P&L theo SẢN PHẨM — cùng nền với tab P&L (Sỹ Anh chốt 28/09/2026).
//
// Đơn đã chốt + giá vốn + phí ship: lib/talpha/order-costs.ts (chung với tab P&L).
// Doanh số một sản phẩm = tiền đơn chia theo SỐ LƯỢNG từng dòng hàng — POS để giá bán cấp
// dòng hàng = 0 nên không có cách chia nào đúng hơn. Phí ship chia cùng tỷ lệ.
// Tiền ads = chi tiêu campaign có ô mã sản phẩm ("…/040/…", parseProductCode), chỉ campaign
// nhận ra người trong team như file TỔNG TEAM. Campaign không ghi mã → một dòng riêng.
//
// Trước đây tab đọc vw_orders_std × vw_product_catalog_std: bảng product_catalog 0 dòng từ
// ngày dựng dự án nên tab gần như trống, và chỉ tính đơn ĐÃ GIAO XONG.
// ═══════════════════════════════════════════════════════════════════

type Products = Record<string, { name?: string; _nhan_bang_gia?: string } | string>;
const PRODUCTS = ((RULES as unknown as { products?: Products }).products || {}) as Products;

function productName(sp: string, rawName: string): string {
    if (sp.startsWith("?:")) return rawName || sp.slice(2);
    if (sp.includes(":")) return rawName;                       // hàng tra giá theo tên (UAE)
    const p = PRODUCTS[sp];
    if (p && typeof p === "object") return p._nhan_bang_gia || p.name || sp;
    return sp;
}

type ProductRow = {
    sp: string; ten: string; shops: Set<string>; don: Set<string>;
    units: number; doanh_so: number; ship: number; cogs: number; ads: number; mess: number;
    gia_vnd: number | null;
};

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const fromIn = q.get("from") || "";
    const to = q.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    // Phân quyền theo team: đơn theo shop, tiền ads theo nước ở tên campaign — cùng luật
    // tách chi tiêu theo nước của Sheet (campaignMarket).
    const a = await getAccess(req);
    const restricted = !a || !seesAllMarkets(a);
    const canSee = (m: string | null | undefined) => !!a && !!m && canMarket(a, m);

    try {
        const [{ don: orders, thieu: missingCosts, ship_basis }, campRows] = await Promise.all([
            computeOrderCosts(from, to, restricted ? (shop) => canSee(shop) : undefined),
            query(
                `SELECT campaign_name, SUM(spend) AS spend, SUM(messages) AS messages
                 FROM vw_fb_ads_std
                 WHERE date BETWEEN @from::date AND @to::date AND spend > 0
                 GROUP BY 1`,
                { from, to },
            ),
        ]);

        const map = new Map<string, ProductRow>();
        const rowFor = (sp: string, name: string) => {
            let d = map.get(sp);
            if (!d) {
                d = { sp, ten: productName(sp, name), shops: new Set(), don: new Set(), units: 0, doanh_so: 0, ship: 0, cogs: 0, ads: 0, mess: 0, gia_vnd: null };
                map.set(sp, d);
            }
            return d;
        };

        for (const o of orders) {
            const lines = o.dong.length ? o.dong : [{ sp: "?:(đơn không có dòng hàng)", ten: "(đơn không có dòng hàng)", qty: 1, gia_vnd: null }];
            const totalQty = lines.reduce((s, x) => s + (x.qty || 0), 0);
            for (const x of lines) {
                // Chia theo số lượng; đơn mà mọi dòng đều SL 0 thì chia đều.
                const share = totalQty > 0 ? (x.qty || 0) / totalQty : 1 / lines.length;
                const d = rowFor(x.sp, x.ten);
                d.shops.add(o.shop);
                d.don.add(o.key);
                d.units += x.qty || 0;
                d.doanh_so += o.vnd * share;
                d.ship += (o.ship || 0) * share;
                if (x.gia_vnd !== null) { d.cogs += x.gia_vnd * (x.qty || 0); d.gia_vnd = x.gia_vnd; }
            }
        }

        // Tiền ads theo mã sản phẩm trong tên campaign — chỉ campaign của người trong team.
        let adsWithoutCode = 0, adsOutsideTeam = 0;
        for (const r of campRows as any[]) {
            const cn = String(r.campaign_name || "");
            if (restricted && !canSee(campaignMarket(cn).market)) continue;
            const spend = Number(r.spend || 0);
            if (!parseCampaign(cn)[1]) { adsOutsideTeam += spend; continue; }
            const productCode = parseProductCode(cn);
            if (!productCode) { adsWithoutCode += spend; continue; }
            const d = rowFor(productCode, productCode);
            d.ads += spend;
            d.mess += Number(r.messages || 0);
        }

        const rows = [...map.values()].map((d) => ({
            sp: d.sp,
            ten: d.ten,
            ma: /^\d{3}$/.test(d.sp) ? d.sp : null,
            thieu_gia: d.sp.startsWith("?:"),
            shops: [...d.shops].sort(),
            orders: d.don.size,
            units: d.units,
            doanh_so: d.doanh_so,
            ads: d.ads,
            mess: d.mess,
            ship: d.ship,
            cogs: d.cogs,
            gia_vnd: d.gia_vnd,
            lai: d.doanh_so - d.ads - d.ship - d.cogs,
        })).sort((a, b) => b.doanh_so - a.doanh_so || b.ads - a.ads);

        const total = rows.reduce((s, r) => ({
            orders: s.orders, units: s.units + r.units, doanh_so: s.doanh_so + r.doanh_so, ads: s.ads + r.ads,
            ship: s.ship + r.ship, cogs: s.cogs + r.cogs,
        }), { orders: orders.length, units: 0, doanh_so: 0, ads: 0, ship: 0, cogs: 0 });

        return NextResponse.json({
            from, to, rows,
            total: { ...total, ads_khong_ma: adsWithoutCode, ads_ngoai_team: adsOutsideTeam,
                lai: total.doanh_so - total.ads - adsWithoutCode - total.ship - total.cogs },
            missing_costs: missingCosts,
            ship_basis,
        });
    } catch (e: any) {
        console.error("product-pnl:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
