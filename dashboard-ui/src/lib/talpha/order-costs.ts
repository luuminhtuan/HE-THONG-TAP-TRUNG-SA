// ═══════════════════════════════════════════════════════════════════
// Giá vốn và phí ship của TỪNG ĐƠN đã chốt — dùng chung cho tab P&L (/api/talpha/pnl-costs)
// và tab P&L theo SP (/api/talpha/product-pnl). Một chỗ tính, hai tab không lệch nhau.
//
// Cùng tập đơn với cột Doanh Số của file TỔNG TEAM: đơn trên POS trừ huỷ, nháp và đơn trống,
// ngày theo giờ Việt Nam. Tiền đơn quy VND như Sheet: (cod > 0 ? cod : total_price) ÷ số chia
// của shop × tỷ giá.
//
// GIÁ VỐN: mã 3 số trong tên sản phẩm POS ("011-ATTL birth month set", "040 - VONGVANG1")
// → giá tệ trong talpha_rules.json → products, quy VND theo cost_rate_rmb_vnd. Cùng cách
// Sổ đơn hàng đọc cột SKU của file đối tác (productCodes · costPriceVnd). Tên gõ tay không
// có mã thì tra product_name_aliases; shop UAE đánh số sản phẩm riêng nên tra giá theo tên
// (markets.UAE.product_costs_vnd, bằng đồng). Không đi qua vw_orders_std: view nối qua bảng
// product_catalog, mà bảng đó 0 dòng từ ngày dựng dự án nên cogs_vnd của view luôn 0.
// Mã chưa khai giá KHÔNG coi là 0 — trả ra danh sách thiếu.
//
// PHÍ SHIP — ƯỚC TÍNH, vì phí từng đơn chỉ có khi 3PL gửi sao kê:
//   • Đài (TW): phí trung bình một kiện trong các kỳ sao kê NAZA đã tải lên.
//   • Singapore (SG): bảng giá shipping_fees.SG tính cho TỪNG đơn — chặng đầu theo 0,1 kg
//     (cân lấy trung bình kiện NAZA Đài, cùng loại hàng) + chặng cuối + phí gửi lẻ + phí
//     thu hộ COD (% tiền của chính đơn đó, có mức sàn).
//   • UAE (AE): bảng giá D&T Fulfillment shipping_fees.AE — phí fulfillment theo bậc số đơn
//     trung bình/ngày + vận chuyển đơn thành công (đồng giá dưới 1 kg) + thu hộ COD % tiền đơn.
//   • Nhật (JP, 13/10/2026): bảng giá NAZA shipping_fees.JP (lib/talpha/jp-shipping-fee.ts) — cước
//     theo bậc 0,5 kg (cân lấy từ kiện NAZA Đài như Singapore) + thu hộ theo bậc tiền COD (yên).
//   • Nước khác: không đoán — null để giao diện ghi "thiếu".
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";
import {
    COST_RATE_RMB_VND, EXCHANGE_RATES, POS_TIMEZONE, RULES, SHOP2MKT,
    costPriceVnd, posMoneyDivisor,
} from "@/lib/talpha/rules";
import { productCodes } from "@/lib/talpha/order-ledger";
import { JP_FEE_SCHEDULE, jpFreightRmb, jpShippingFeeVnd } from "@/lib/talpha/jp-shipping-fee";
import { readStoreFresh } from "@/lib/talpha/store";

type FeeLine = { ship_fee?: number; op_fee?: number; chargeable_kg?: number | null };
type Statement = {
    naza?: {
        summary?: { rate_rmb_vnd?: number | null; fees_combined?: boolean };
        fee_lines?: FeeLine[];
    };
};
type SgFees = {
    first_leg_per_100g?: { thuong?: number };
    last_leg?: { first_2kg?: number; extra_per_kg?: number };
    cod_fee?: { pct?: number; min?: number };
    single_parcel_fee?: number;
};
type AeFees = {
    fulfillment_fee_tiers?: { max_orders_per_day: number; fee: number }[];
    delivered_ship_fee?: number;
    cod_fee_pct?: number;
};

const FEES = (RULES as unknown as { shipping_fees?: Record<string, unknown> }).shipping_fees || {};
const SG_FEES = (FEES.SG as SgFees | undefined) || null;
const AE_FEES = (FEES.AE as AeFees | undefined) || null;

/** Phí fulfillment D&T theo bậc: bậc đầu tiên có trần ≥ số đơn trung bình/ngày; vượt hết thì bậc cuối. */
function aeFulfillmentFee(ordersPerDay: number): number | null {
    const bac = [...(AE_FEES?.fulfillment_fee_tiers || [])].sort((a, b) => a.max_orders_per_day - b.max_orders_per_day);
    if (!bac.length) return null;
    return (bac.find((b) => ordersPerDay < b.max_orders_per_day) || bac[bac.length - 1]).fee;
}

// Khoá so sánh cho tên gõ tay: chữ HOA, dạng NFC. POS có lúc lưu tiếng Việt ở dạng dấu
// tách rời (NFD) — "MỌC TÓC VN" hai kiểu mã hoá nhìn giống hệt nhau mà so bằng thì trượt.
export const nameKey = (s: string) => s.normalize("NFC").trim().toUpperCase();
const ALIASES: Record<string, string> = Object.fromEntries(
    Object.entries((RULES as unknown as { product_name_aliases?: Record<string, string> }).product_name_aliases || {})
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => [nameKey(k), v]));

// Shop nào đặt tên sản phẩm theo mã 3 số của bảng giá. UAE đánh số riêng ("Oralhoe Dental 002")
// — đọc số cuối tên là lấy nhầm giá mã 002 (vòng phong thuỷ). markets.*.product_code_in_name.
const CODE_IN_NAME_BY_SHOP: Record<string, boolean> = Object.fromEntries(
    Object.values(RULES.markets as Record<string, { shop_label?: string; product_code_in_name?: boolean }>)
        .filter((m) => m && typeof m === "object" && m.shop_label)
        .map((m) => [String(m.shop_label).toUpperCase(), m.product_code_in_name !== false]));

// Giá vốn theo TÊN sản phẩm, bằng ĐỒNG, riêng từng shop (markets.*.product_costs_vnd) — shop UAE
// đặt tên riêng và Sỹ Anh báo giá bằng đồng (25/09/2026). Một cái = tiền hàng + hộp trang sức.
//
// Tra MÃ VẠCH POS trước (04/11/2026): ngày 07/10 shop UAE đổi tên cả ba món ("Oralhoe Dental 002"
// → "Health Product - 01"…) — cùng product_id, cùng mã vạch — và tra theo tên là 178/230 đơn tháng
// 10 mất giá vốn. Mục nào khai `barcode` thì đổi tên bao nhiêu lần vẫn ra đúng giá; khoá gom ở tab
// P&L theo SP lấy tên khai trong bảng nên tên cũ và tên mới gộp làm một dòng.
type ShopPrice = { gia: number; ten: string };
const COST_BY_NAME: Record<string, Record<string, number>> = {};
const COST_BY_BARCODE: Record<string, Record<string, ShopPrice>> = {};
for (const m of Object.values(RULES.markets as Record<string, {
    shop_label?: string; product_costs_vnd?: Record<string, { hang?: number; hop?: number; barcode?: string | string[] } | string>;
}>)) {
    if (!m || typeof m !== "object" || !m.shop_label || !m.product_costs_vnd) continue;
    const byName: Record<string, number> = {}, barcodePrice: Record<string, ShopPrice> = {};
    for (const [name, v] of Object.entries(m.product_costs_vnd)) {
        if (name.startsWith("_") || typeof v !== "object" || !(Number(v.hang) > 0)) continue;
        const unitCost = Number(v.hang) + Number(v.hop || 0);
        byName[nameKey(name)] = unitCost;
        for (const code of [v.barcode || []].flat()) if (String(code).trim()) barcodePrice[String(code).trim()] = { gia: unitCost, ten: nameKey(name) };
    }
    COST_BY_NAME[String(m.shop_label).toUpperCase()] = byName;
    COST_BY_BARCODE[String(m.shop_label).toUpperCase()] = barcodePrice;
}

/** Đọc kho sao kê NAZA (Đài): phí trung bình một kiện + cân tính phí trung bình. */
async function loadNazaFeeStats() {
    const store = await readStoreFresh<{ statements: Statement[] }>("cod_statements", { statements: [] });
    let parcelCount = 0, vnd = 0, periodCount = 0, weighedParcels = 0, totalKg = 0, total100gSteps = 0, total500gSteps = 0;
    for (const s of store.statements || []) {
        const lines = s.naza?.fee_lines || [];
        if (!lines.length) continue;
        periodCount += 1;
        const rate = s.naza?.summary?.rate_rmb_vnd || COST_RATE_RMB_VND;
        // File gộp "phí vận chuyển + phí thao tác" vào một cột thì op_fee đã nằm trong ship_fee.
        const feesCombined = !!s.naza?.summary?.fees_combined;
        for (const l of lines) {
            const rmb = Math.abs(Number(l.ship_fee || 0)) + (feesCombined ? 0 : Math.abs(Number(l.op_fee || 0)));
            parcelCount += 1;
            vnd += rmb * rate;
            const kg = Number(l.chargeable_kg || 0);
            if (kg > 0) {
                weighedParcels += 1;
                totalKg += kg;
                // Chặng đầu Singapore tính theo TỪNG 0,1 kg — làm tròn lên từng kiện rồi mới lấy trung bình.
                total100gSteps += Math.ceil(kg * 10 - 1e-9);
                // Cước Nhật tính theo bậc 0,5 kg — cũng làm tròn lên từng kiện (tối thiểu 1 bậc).
                total500gSteps += Math.max(1, Math.ceil(kg * 2 - 1e-9));
            }
        }
    }
    return {
        tw: parcelCount ? { per_order_vnd: vnd / parcelCount, parcels: parcelCount, periods: periodCount } : null,
        can: weighedParcels ? { kg_tb: totalKg / weighedParcels, nac_100g_tb: total100gSteps / weighedParcels, bac_500g_tb: total500gSteps / weighedParcels, kien: weighedParcels } : null,
    };
}

/** Phí ship một đơn Singapore theo bảng giá (RMB). null = thiếu bảng giá hoặc thiếu cân. */
function shipSgRmb(codRmb: number, can: { kg_tb: number; nac_100g_tb: number } | null): number | null {
    const f = SG_FEES;
    if (!f || !can || !f.first_leg_per_100g?.thuong || !f.last_leg?.first_2kg) return null;
    const firstLeg = f.first_leg_per_100g.thuong * can.nac_100g_tb;
    const lastLeg = f.last_leg.first_2kg + Math.max(0, can.kg_tb - 2) * (f.last_leg.extra_per_kg || 0);
    const cod = Math.max((f.cod_fee?.pct || 0) * codRmb, f.cod_fee?.min || 0);
    return firstLeg + lastLeg + cod + (f.single_parcel_fee || 0);
}

/**
 * Một dòng hàng của đơn, đã tra giá. `sp` = khoá sản phẩm để gom tab P&L theo SP:
 * mã 3 số ("040"), hoặc "<SHOP>:<TÊN>" cho hàng tra giá theo tên (UAE), hoặc
 * "?:<tên>" khi chưa tra được giá. Dòng ghép nhiều mã ("042 - BLACK + 043 - COFFEE")
 * tách thành nhiều dòng, mỗi mã một dòng, cùng số lượng.
 */
export type OrderLine = { sp: string; ten: string; qty: number; gia_vnd: number | null };
export type OrderCost = {
    key: string; shop: string; d: string;
    /** Tiền đơn quy VND — cùng cách Sheet tính cột Doanh Số. */
    vnd: number;
    cogs: number;
    /** true = mọi dòng hàng đều đã có giá vốn. */
    du: boolean;
    /** Phí ship ước tính (VND); null = nước chưa có sao kê/bảng giá. */
    ship: number | null;
    dong: OrderLine[];
};
export type MissingCost = { ma: string; ten: string; qty: number; orders: number };

/**
 * `chiShop` (phân quyền theo team, 05/10/2026): chỉ giữ đơn của shop được xem (mã "TW"…).
 * Bỏ trống = mọi shop. Lọc ngay từ dòng đầu nên mã thiếu giá, cơ sở phí ship cũng chỉ
 * còn của nước đó.
 */
export async function computeOrderCosts(from: string, to: string, shopFilter?: (shop: string) => boolean): Promise<{
    don: OrderCost[]; thieu: MissingCost[]; ship_basis: Record<string, string>;
}> {
    const rows = await query(
        `
            WITH don AS (
                SELECT id, shop_id, UPPER(shop_label) AS shop,
                       date_in_tz(inserted_at, @tz) AS d,
                       COALESCE(cod, 0) AS cod, COALESCE(total_price, 0) AS total_price
                FROM sale_order
                WHERE date_in_tz(inserted_at, @tz) BETWEEN @from::date AND @to::date
                  AND status_category NOT IN ('HUY', 'DON_THO')
                  -- Đơn trống (0 sản phẩm, 0 tiền) — Sheet không đếm (sql_is_empty_order).
                  -- total_quantity là chuỗi: không phải số thì coi như 0 (như SAFE_CAST cũ).
                  AND NOT (COALESCE(CASE WHEN total_quantity ~ '^[[:space:]]*[-+]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][-+]?[0-9]+)?[[:space:]]*$'
                                         THEN total_quantity::float8 END, 0) = 0
                           AND COALESCE(total_price, 0) = 0 AND COALESCE(cod, 0) = 0)
            )
            SELECT don.id, don.shop, to_char(don.d, 'YYYY-MM-DD') AS d, don.cod, don.total_price,
                   i.product_name, i.variation_name, i.barcode, COALESCE(i.quantity, 0) AS qty
            FROM don
            LEFT JOIN order_items i
                   ON i.order_id = don.id AND i.shop_id = don.shop_id`,
        { from, to, tz: POS_TIMEZONE },
    );

    const orderMap = new Map<string, OrderCost>();
    const missing = new Map<string, { ma: string; ten: string; qty: number; don: Set<string> }>();
    for (const r of rows as any[]) {
        if (shopFilter && !shopFilter(r.shop)) continue;
        const key = `${r.shop}-${r.id}`;
        let o = orderMap.get(key);
        if (!o) {
            const local = (Number(r.cod) > 0 ? Number(r.cod) : Number(r.total_price)) / posMoneyDivisor(r.shop);
            o = { key, shop: r.shop, d: r.d, vnd: local * (EXCHANGE_RATES[SHOP2MKT[r.shop]] || 0), cogs: 0, du: true, ship: null, dong: [] };
            orderMap.set(key, o);
        }
        if (r.product_name == null && r.variation_name == null) { o.du = false; continue; }  // đơn không có dòng hàng
        const name = `${r.product_name || ""} ${r.variation_name || ""}`.trim();
        const qty = Number(r.qty || 0);
        const recordMissing = (code: string) => {
            const t = missing.get(code) || { ma: code, ten: name, qty: 0, don: new Set<string>() };
            t.qty += qty; t.don.add(key); missing.set(code, t);
            o!.du = false;
            o!.dong.push({ sp: `?:${name || "(không tên)"}`, ten: name, qty, gia_vnd: null });
        };
        // Tên khai tay ở product_name_aliases thắng; sau đó giá theo tên của shop (UAE); cuối cùng
        // mới đọc mã 3 số trong tên (chỉ ở shop đặt tên theo mã của bảng giá).
        const biDanh = ALIASES[nameKey(name)];
        const barcodePrice = r.barcode ? COST_BY_BARCODE[r.shop]?.[String(r.barcode).trim()] : undefined;
        const costByName = COST_BY_NAME[r.shop]?.[nameKey(name)];
        if (!biDanh && barcodePrice) {
            o.cogs += barcodePrice.gia * qty;
            o.dong.push({ sp: `${r.shop}:${barcodePrice.ten}`, ten: name, qty, gia_vnd: barcodePrice.gia });
            continue;
        }
        if (!biDanh && costByName !== undefined) {
            o.cogs += costByName * qty;
            o.dong.push({ sp: `${r.shop}:${nameKey(name)}`, ten: name, qty, gia_vnd: costByName });
            continue;
        }
        const codes = biDanh ? [biDanh] : CODE_IN_NAME_BY_SHOP[r.shop] === false ? [] : productCodes(name);
        if (!codes.length) { recordMissing(name || "(không tên)"); continue; }
        for (const c of codes) {
            const unitCost = costPriceVnd(c);
            if (unitCost === null) { recordMissing(c); continue; }
            o.cogs += unitCost * qty;
            o.dong.push({ sp: c, ten: name, qty, gia_vnd: unitCost });
        }
    }

    const naza = await loadNazaFeeStats();
    // UAE: bậc phí fulfillment theo số đơn TRUNG BÌNH/NGÀY của khoảng đang xem.
    const dayCount = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
    const aeOrders = [...orderMap.values()].filter((o) => o.shop === "AE").length;
    const fulfillAe = aeFulfillmentFee(aeOrders / dayCount);
    const aeRate = EXCHANGE_RATES[SHOP2MKT.AE] || 0;
    const jpRate = EXCHANGE_RATES[SHOP2MKT.JP] || 0;
    for (const o of orderMap.values()) {
        if (o.shop === "TW") o.ship = naza.tw ? naza.tw.per_order_vnd : null;
        else if (o.shop === "SG") {
            const rmb = shipSgRmb(o.vnd / COST_RATE_RMB_VND, naza.can);
            o.ship = rmb === null ? null : rmb * COST_RATE_RMB_VND;
        } else if (o.shop === "AE") {
            o.ship = fulfillAe === null || !AE_FEES?.delivered_ship_fee || !aeRate ? null
                : (fulfillAe + AE_FEES.delivered_ship_fee + (AE_FEES.cod_fee_pct || 0) * (o.vnd / aeRate)) * aeRate;
        } else if (o.shop === "JP") {
            o.ship = jpRate ? jpShippingFeeVnd(o.vnd / jpRate, naza.can ? naza.can.bac_500g_tb : null, jpRate, COST_RATE_RMB_VND) : null;
        }
    }

    // Cơ sở ước tính phí ship từng nước — giao diện in ra để người đọc biết số từ đâu.
    const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
    const tbShip = (shop: string) => {
        const ds = [...orderMap.values()].filter((o) => o.shop === shop && o.ship !== null);
        return ds.length ? ds.reduce((s, o) => s + (o.ship || 0), 0) / ds.length : null;
    };
    const ship_basis: Record<string, string> = {};
    if (naza.tw) {
        ship_basis.TW = `${fmt(naza.tw.per_order_vnd)}đ/đơn = trung bình ${fmt(naza.tw.parcels)} kiện trong ${naza.tw.periods} kỳ sao kê NAZA (phí vận chuyển + phí thao tác, quy VND theo tỷ giá từng kỳ).`;
    }
    const sg = tbShip("SG");
    if (SG_FEES && naza.can && sg !== null) {
        ship_basis.SG = `trung bình ${fmt(sg)}đ/đơn theo bảng giá Singapore: chặng đầu `
            + `${SG_FEES.first_leg_per_100g?.thuong} tệ/0,1 kg × ${naza.can.nac_100g_tb.toFixed(2)} (cân tính phí trung bình `
            + `${naza.can.kg_tb.toFixed(2)} kg của ${fmt(naza.can.kien)} kiện NAZA Đài) + chặng cuối ${SG_FEES.last_leg?.first_2kg} tệ `
            + `+ gửi lẻ ${SG_FEES.single_parcel_fee || 0} tệ + thu hộ COD ${((SG_FEES.cod_fee?.pct || 0) * 100).toFixed(0)}% tiền đơn `
            + `(tối thiểu ${SG_FEES.cod_fee?.min || 0} tệ), quy ${fmt(COST_RATE_RMB_VND)}đ/tệ. Chưa gồm phí hàng hoàn.`;
    }
    const ae = tbShip("AE");
    if (AE_FEES && ae !== null) {
        ship_basis.AE = `trung bình ${fmt(ae)}đ/đơn theo bảng giá D&T Fulfillment: `
            + `fulfillment ${fulfillAe} AED (${(aeOrders / dayCount).toFixed(1)} đơn/ngày) + vận chuyển đơn thành công `
            + `${AE_FEES.delivered_ship_fee} AED + thu hộ COD ${((AE_FEES.cod_fee_pct || 0) * 100).toFixed(0)}% tiền đơn, `
            + `quy ${fmt(aeRate)}đ/AED. Đơn hoàn chỉ mất phí fulfillment — P&L đang tính như đơn giao thành công.`;
    }
    const jp = tbShip("JP");
    if (JP_FEE_SCHEDULE && naza.can && jp !== null) {
        const bac = naza.can.bac_500g_tb;
        ship_basis.JP = `trung bình ${fmt(jp)}đ/đơn theo bảng giá NAZA Nhật: cước ${JP_FEE_SCHEDULE.first_half_kg?.thuong} tệ 0,5 kg đầu `
            + `+ ${JP_FEE_SCHEDULE.extra_half_kg?.thuong} tệ mỗi 0,5 kg tiếp (trung bình ${bac.toFixed(2)} bậc 0,5 kg/kiện theo cân `
            + `${fmt(naza.can.kien)} kiện NAZA Đài → ${(jpFreightRmb(bac) || 0).toFixed(1)} tệ) + phí thu hộ theo bậc tiền COD `
            + `(${(JP_FEE_SCHEDULE.cod_fee_jpy_tiers || []).map((x) => `≤${fmt(x.max_cod_jpy)}¥: ${x.fee}¥`).join(" · ")}), `
            + `quy ${fmt(COST_RATE_RMB_VND)}đ/tệ, ${fmt(jpRate)}đ/yên. Chưa gồm phụ thu vùng xa 1.600¥, phí từ chối / hoàn 800¥.`;
    }
    if (shopFilter) for (const k of Object.keys(ship_basis)) if (!shopFilter(k)) delete ship_basis[k];

    return {
        don: [...orderMap.values()],
        thieu: [...missing.values()]
            .map((t) => ({ ma: t.ma, ten: t.ten, qty: t.qty, orders: t.don.size }))
            .sort((a, b) => b.orders - a.orders),
        ship_basis,
    };
}
