import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { MARKETS_PUBLIC, PHONE_RULES } from "@/lib/talpha/rules";
import { buildAlerts, trackMarket, TRACK_MARKETS } from "@/lib/talpha/tracking";
import { loadMarketShipments, partnerSourceLabel } from "@/lib/talpha/tracking-market";
import { buildMarketLedger, type ProductInfo } from "@/lib/talpha/market-ledger";
import { todayVn, filterByOrderDate } from "@/lib/talpha/order-ledger";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// SỔ ĐƠN HÀNG — THỊ TRƯỜNG NGOÀI ĐÀI (Sỹ Anh yêu cầu 29/09/2026)
//
//   GET ?market=SG|AE — mọi đơn của nước đó: khách, hàng, trạng thái giao, đèn việc phải làm,
//                       link WhatsApp của khách.
//       &from&to=YYYY-MM-DD — chỉ đơn LÊN ĐƠN trong khoảng (27/10/2026, locTheoNgayLenDon).
//                       Cảnh báo vẫn tính trên mọi đơn rồi mới lọc — đèn của một đơn không
//                       đổi theo khoảng ngày đang xem.
//
// Đơn và trạng thái đọc CHUNG hàm với Theo dõi vận đơn và Đối soát COD (loadMarketShipments):
//   • Singapore: bảng đối tác (partner_orders) + 17TRACK;
//   • UAE: đơn POS + trạng thái tra ở WeShip.
// Hàng của đơn đọc thêm: Singapore ở cột SKU của bảng đối tác, UAE ở dòng hàng POS (order_items).
// Đài Loan KHÔNG đi qua đây: sổ Đài là /api/talpha/order-ledger (bảng NAZA + sao kê NAZA).
// ═══════════════════════════════════════════════════════════════════

type Empty = { registered: Record<string, never>; statuses: Record<string, unknown>; last_sync?: { at: string; ok: boolean } };

/** Hàng của từng đơn. Đọc hỏng thì trả rỗng kèm lời báo — sổ vẫn hiện đơn, chỉ thiếu cột hàng. */
async function loadOrderProducts(code: string, partnerMarket: string | null): Promise<{ map: Map<string, ProductInfo>; loi: string | null }> {
    const map = new Map<string, ProductInfo>();
    try {
        if (partnerMarket) {
            const rows = await query<{ order_no: string; sku: string | null; quantity: number | null }>(
                `SELECT order_no, sku, quantity FROM partner_orders WHERE market = @m`,
                { m: partnerMarket },
            );
            for (const r of rows) {
                const k = String(r.order_no || "").trim();
                if (!k || map.has(k)) continue;
                map.set(k, { sku: String(r.sku || "").trim(), quantity: r.quantity ?? null });
            }
        } else {
            const rows = await query<{ order_id: string; product_name: string | null; variation_name: string | null; quantity: number | null }>(
                `SELECT i.order_id, i.product_name, i.variation_name, i.quantity
                 FROM order_items i
                 JOIN (SELECT DISTINCT shop_id, order_id FROM vw_orders_std WHERE market = @m) v
                   ON v.shop_id = i.shop_id AND v.order_id = i.order_id
                 ORDER BY i.order_id, i.product_name`,
                { m: code },
            );
            const merged = new Map<string, { ten: string[]; sl: number }>();
            for (const r of rows) {
                const k = String(r.order_id || "");
                const g = merged.get(k) || { ten: [], sl: 0 };
                const qty = Number(r.quantity) || 0;
                const label = [r.product_name, r.variation_name].filter(Boolean).join(" · ") || "(không tên)";
                g.ten.push(qty > 1 ? `${label} ×${qty}` : label);
                g.sl += qty;
                merged.set(k, g);
            }
            for (const [k, g] of merged) map.set(k, { sku: g.ten.join(", "), quantity: g.sl || null });
        }
        return { map, loi: null };
    } catch (e) {
        console.warn("order-ledger/market: không đọc được hàng của đơn:", e);
        return { map, loi: "Không đọc được sản phẩm của đơn — cột Hàng đang trống." };
    }
}

export async function GET(req: NextRequest) {
    const code = String(req.nextUrl.searchParams.get("market") || "").toUpperCase();
    const m = MARKETS_PUBLIC.markets.find((x) => x.code === code);
    const tm = trackMarket(code);
    if (!m || code === "TW" || tm.code !== code) {
        return NextResponse.json({
            error: `market phải là mã một nước ngoài Đài đã khai tracking.markets (${TRACK_MARKETS.filter((x) => x.code !== "TW").map((x) => x.code).join(", ")})`,
        }, { status: 400 });
    }
    try {
        const { shipments, store, lastImport } = await loadMarketShipments(tm, (): Empty => ({ registered: {}, statuses: {} }));
        const alerts = buildAlerts(shipments, new Date(), { staleDays: tm.stale_days });
        const products = await loadOrderProducts(code, tm.source === "partner" ? tm.partner_market : null);
        const sp = req.nextUrl.searchParams;
        const inRange = filterByOrderDate(shipments, sp.get("from"), sp.get("to"), todayVn());
        const rows = buildMarketLedger(inRange, products.map, alerts, {
            rateVnd: m.rate_vnd,
            phone: PHONE_RULES[code] ?? null,
            carrier: tm.provider === "weship" ? "WeShip" : undefined,
            currency: m.currency,
        });
        const isPos = tm.source === "pos";
        return NextResponse.json({
            market: { code: m.code, display: m.display, currency: m.currency, symbol: m.symbol, rate_vnd: m.rate_vnd },
            nguon: isPos
                ? { nhan: "Đơn POS + trạng thái tra ở WeShip", cap_nhat: store.last_sync?.ok ? store.last_sync.at : null, loai: "tra" }
                : { nhan: partnerSourceLabel(shipments, store as { last_sync?: { register_rejected?: number } }), cap_nhat: lastImport, loai: "nap" },
            canh_bao: products.loi,
            rows,
        });
    } catch (e) {
        console.error("order-ledger/market lỗi:", e);
        return NextResponse.json({ error: "Không đọc được đơn của nước này" }, { status: 500 });
    }
}
