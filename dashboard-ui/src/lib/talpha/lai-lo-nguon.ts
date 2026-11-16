// ═══════════════════════════════════════════════════════════════════
// LÃI LỖ — nạp KIỆN THẬT của từng nước thành `Kien` (lib/talpha/lai-lo.ts).
//
// Mỗi nước đọc đúng nguồn mà Sổ đơn hàng / Tiền COD về / Theo dõi vận đơn đang đọc — một
// kiện chỉ có một trạng thái, một số tiền, ở mọi màn:
//   • Đài (TW): sổ đơn Đài (lib/talpha/so-don-dai.ts) — bảng NAZA + 17TRACK + mọi kỳ sao kê.
//     Phí từng kiện là phí THẬT trong sheet PHÍ của sao kê (NAZA thu cả kiện hoàn); kiện chưa
//     vào kỳ nào thì lấy phí trung bình các kiện đã có. Tiền NAZA trả quy VND theo tỷ giá
//     TWD→tệ→đồng của chính kỳ đó; kiện chưa trả theo tỷ giá kỳ mới nhất.
//   • Singapore, Nhật (SG, JP): bảng đối tác (bảng partner_orders) + 17TRACK; phí từng kiện
//     ở sao kê NAZA nước đó (phi_dong, thu_ho); thiếu thì ước theo trung bình kiện đã có sao
//     kê, chưa có kiện nào thì theo bảng giá shipping_fees.
//   • UAE (AE): đơn POS (không có bảng đối tác) + trạng thái WeShip; POS đã ghi giao/hoàn thì
//     tin POS khi WeShip chưa kết thúc. Phí theo bảng giá D&T (chưa có sao kê nào).
// Giá vốn: mã 3 số trong SKU × bảng products (Đài theo tỷ giá tệ của kỳ trả tiền); UAE tra theo
// tên hàng (markets.UAE.product_costs_vnd) qua lib/talpha/order-costs.ts.
// ═══════════════════════════════════════════════════════════════════
import { query } from "@/lib/db";
import { readStoreFresh } from "@/lib/talpha/store";
import {
    COST_RATE_RMB_VND, EXCHANGE_RATES, RULES, SHOP2MKT, costPriceVnd,
} from "@/lib/talpha/rules";
import { redeliveryOrigin, productCodes } from "@/lib/talpha/order-ledger";
import { loadTwOrderLedger } from "@/lib/talpha/so-don-dai";
import { loadPartnerMarketShipments } from "@/lib/talpha/tracking-market";
import { TERMINAL, trackMarket } from "@/lib/talpha/tracking";
import { awbFromPartner } from "@/lib/talpha/weship";
import { computeOrderCosts } from "@/lib/talpha/order-costs";
import { JP_FEE_SCHEDULE, jpFreightRmb, jpCodFee } from "@/lib/talpha/phi-ship-nhat";
import { classifyParcel, type Parcel } from "@/lib/talpha/lai-lo";

type Cfg = {
    ty_le_giao?: { cua_so_ngay?: number; bo_gan_ngay?: number; mau_toi_thieu?: number };
    cho_len_3pl_ngay?: number;
    hang_hoan?: { quay_lai_kho_ban_tiep?: string[]; luu_kho_ngay?: number; ve_kho_sau_gui_ngay?: number };
    nhom_van_hanh?: string[];
};
export const KQKD: Cfg = (RULES as unknown as { ket_qua_kd?: Cfg }).ket_qua_kd || {};
export const DELIVERY_RATE_CFG = {
    cua_so_ngay: Number(KQKD.ty_le_giao?.cua_so_ngay ?? 90),
    bo_gan_ngay: Number(KQKD.ty_le_giao?.bo_gan_ngay ?? 21),
    mau_toi_thieu: Number(KQKD.ty_le_giao?.mau_toi_thieu ?? 20),
};
export const PENDING_3PL_DAYS = Number(KQKD.cho_len_3pl_ngay ?? 3);
export const OPEX_CATEGORIES = KQKD.nhom_van_hanh?.length ? KQKD.nhom_van_hanh : ["Lương", "Mặt bằng", "Phần mềm & công cụ", "Khác"];
const RESTOCKABLE_MARKETS = new Set((KQKD.hang_hoan?.quay_lai_kho_ban_tiep || ["AE"]).map((x) => x.toUpperCase()));
const FREE_STORAGE_DAYS = Number(KQKD.hang_hoan?.luu_kho_ngay ?? 30);
const RETURN_TO_WAREHOUSE_DAYS = Number(KQKD.hang_hoan?.ve_kho_sau_gui_ngay ?? 14);

const FEES = (RULES as unknown as { shipping_fees?: Record<string, any> }).shipping_fees || {};
const rate = (code: string) => EXCHANGE_RATES[SHOP2MKT[code]] || 0;
const clean = (x?: string | null) => String(x || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
const tb = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");

/** Hàng hoàn còn trong hạn lưu kho miễn phí của 3PL (ước ngày về kho = ngày gửi + VE_KHO_SAU_GUI). */
function isWithinFreeStorage(shipDate: string | null | undefined, date: string, asOf: string, isDestroyed: boolean) {
    if (isDestroyed) return false;
    const baseDate = shipDate || date;
    return !!baseDate && daysBetween(baseDate, asOf) <= RETURN_TO_WAREHOUSE_DAYS + FREE_STORAGE_DAYS;
}

/** Giá vốn theo SKU: mọi mã phải có giá, thiếu một mã là null (cộng nửa vời ra lãi đẹp giả). */
function skuCogs(sku: string | null | undefined, qty: number): number | null {
    const codes = productCodes(sku);
    if (!codes.length) return null;
    let s = 0;
    for (const c of codes) {
        const g = costPriceVnd(c);
        if (g === null) return null;
        s += g * qty;
    }
    return s;
}

export type MarketSource = { kien: Parcel[]; co_so: string[]; nguon: string };

// ─────────────────────────────────────────────────────────────────────────
// ĐÀI
// ─────────────────────────────────────────────────────────────────────────
async function twParcels(asOf: string): Promise<MarketSource> {
    const { rows, stm } = await loadTwOrderLedger(asOf);
    const rTw = rate("TW");
    // Tỷ giá NAZA kỳ mới nhất (TWD→tệ × tệ→đồng) — cho kiện chưa được trả tiền.
    const periods = stm.statements
        .map((s) => ({
            ngay: s.rows.reduce((mx, r) => (r.paid_date > mx ? r.paid_date : mx), ""),
            tw: s.naza?.summary?.rate_twd_rmb ?? null, rv: s.naza?.summary?.rate_rmb_vnd ?? null,
        }))
        .filter((k) => k.tw && k.rv)
        .sort((a, b) => b.ngay.localeCompare(a.ngay));
    const chuoi = periods.length ? periods[0].tw! * periods[0].rv! : null;
    const knownFees = rows.filter((r) => r.fee_vnd != null).map((r) => r.fee_vnd as number);
    const avgFee = tb(knownFees) ?? 0;

    const parcels: Parcel[] = rows.map((r) => {
        const date = r.order_date || r.ship_date || "";
        const group = classifyParcel(r.status, null, r.status_raw, !!r.ship_date);
        // Kiện GIAO LẠI (mã gốc trong ngoặc) dùng chính hàng của kiện hoàn — giá vốn đã tính ở
        // kiện gốc, tính lại là đếm một món hàng hai lần.
        const isRedelivery = !!redeliveryOrigin(r.order_no);
        return {
            nuoc: "TW", ma: r.order_no || r.tracking, ngay: date, ngay_gui: r.ship_date || null, nhom: group,
            trang_thai: r.status_raw || r.status || "",
            cod_vnd: r.cod_twd * rTw,
            cod_that_vnd: r.gross_vnd ?? (chuoi ? r.cod_twd * chuoi : null),
            gia_von_vnd: isRedelivery ? 0 : r.cogs_vnd,
            phi_di_vnd: r.fee_vnd ?? avgFee,
            phi_giao_vnd: 0,
            phi_hoan_vnd: 0,
            phi_that: r.fee_vnd != null,
            hang_ve_kho: RESTOCKABLE_MARKETS.has("TW"),
            hoan_con_han: group === "hoan" && isWithinFreeStorage(r.ship_date, date, asOf, r.status === "Destroyed" || /tiêu hu/i.test(r.status_raw)),
        };
    });
    return {
        kien: parcels,
        nguon: "Bảng đơn NAZA + 17TRACK · sao kê NAZA",
        co_so: [
            `Phí 3PL: phí thật trong sheet PHÍ của ${stm.statements.length} kỳ sao kê NAZA (vận chuyển + thao tác, NAZA thu cả kiện hoàn); `
            + `kiện chưa vào kỳ nào lấy trung bình ${fmt(avgFee)}đ/kiện của ${knownFees.length} kiện đã có phí. Hoàn về kho NAZA miễn phí 1 tháng.`,
            chuoi
                ? `Chênh tỷ giá: NAZA quy TWD→tệ→đồng theo tỷ giá từng kỳ (kỳ mới nhất ${fmt(chuoi)}đ/TWD) so với ${fmt(rTw)}đ/TWD của Doanh số.`
                : "Chênh tỷ giá: chưa có kỳ sao kê nào ghi đủ tỷ giá.",
            "Giá vốn: mã SP trong cột SKU bảng NAZA × bảng products; kiện giao lại không tính giá vốn lần hai.",
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────
// SINGAPORE · NHẬT — bảng đối tác + sao kê NAZA nước đó
// ─────────────────────────────────────────────────────────────────────────
type MarketStatementStore = {
    statements: {
        filename: string; ngay?: string;
        rows?: { tracking: string; amount: number }[];
        naza?: {
            ty_gia_rmb?: number | null; ty_gia_vnd?: number | null;
            phi_dong?: { tracking: string; kg: number | null; ship: number; first_leg: number; op: number }[];
            thu_ho?: { tracking: string; phi_rmb: number }[];
        } | null;
    }[];
};

async function partnerParcels(code: "SG" | "JP", asOf: string): Promise<MarketSource> {
    const mk = trackMarket(code);
    if (mk.code !== code) throw new Error(`chưa khai tracking.markets.${code}`);
    const [{ shipments }, sk] = await Promise.all([
        loadPartnerMarketShipments(mk, () => ({ registered: {}, statuses: {} })),
        readStoreFresh<MarketStatementStore>(`cod_statements_${code.toLowerCase()}`, { statements: [] }),
    ]);
    const rLocal = rate(code);

    // Phí từng kiện trong sao kê, quy VND theo tỷ giá tệ của kỳ đó. Một kiện có thể bị thu ở
    // hai kỳ (NAZA thu bù hàng đặc thù kỳ sau) — cộng dồn.
    const outboundFees = new Map<string, number>(), codFees = new Map<string, number>(), parcelWeights: number[] = [];
    let chuoi: { tw: number; rv: number; ngay: string } | null = null;
    for (const s of sk.statements) {
        const n = s.naza;
        if (!n) continue;
        const rv = Number(n.ty_gia_vnd) || COST_RATE_RMB_VND;
        for (const l of n.phi_dong || []) {
            const k = clean(l.tracking);
            outboundFees.set(k, (outboundFees.get(k) || 0) + (Number(l.ship) + Number(l.first_leg) + Number(l.op)) * rv);
            if (Number(l.kg) > 0) parcelWeights.push(Number(l.kg));
        }
        for (const l of n.thu_ho || []) {
            const k = clean(l.tracking);
            codFees.set(k, (codFees.get(k) || 0) + Number(l.phi_rmb) * rv);
        }
        const date = s.ngay || "";
        if (n.ty_gia_rmb && n.ty_gia_vnd && (!chuoi || date > chuoi.ngay)) chuoi = { tw: n.ty_gia_rmb, rv: n.ty_gia_vnd, ngay: date };
    }
    const knownFees = [...outboundFees.values()];
    const f = FEES[code] || {};

    // Ước khi kiện chưa vào sao kê nào: trung bình kiện đã có (≥ 3 kiện), không thì bảng giá.
    let estOutboundFee: number | null = knownFees.length >= 3 ? tb(knownFees) : null;
    let estimateMethod = estOutboundFee != null ? `trung bình ${fmt(estOutboundFee)}đ/kiện của ${knownFees.length} kiện đã có trong sao kê` : "";
    if (estOutboundFee == null) {
        if (code === "SG" && f.first_leg_per_100g?.thuong && f.last_leg?.first_2kg) {
            const kg = tb(parcelWeights) ?? 0.3;
            const rmb = f.first_leg_per_100g.thuong * Math.ceil(kg * 10 - 1e-9) + f.last_leg.first_2kg + Number(f.single_parcel_fee || 0);
            estOutboundFee = rmb * COST_RATE_RMB_VND;
            estimateMethod = `bảng giá Singapore (${kg.toFixed(1)} kg/kiện): ${rmb.toFixed(1)} tệ`;
        } else if (code === "JP") {
            const rmb = jpFreightRmb(1) ?? 0;
            estOutboundFee = rmb * COST_RATE_RMB_VND;
            estimateMethod = `bảng giá NAZA Nhật 0,5 kg đầu: ${rmb} tệ`;
        } else estOutboundFee = 0;
    }

    const parcels: Parcel[] = shipments.map((s) => {
        const k = clean(s.tracking);
        const date = s.order_date || s.ship_date || "";
        const group = classifyParcel(s.status, s.sub_status, s.raw_status, !!s.ship_date);
        const codVnd = s.cod_local * rLocal;
        const codRmb = chuoi ? s.cod_local * chuoi.tw : codVnd / COST_RATE_RMB_VND;
        let di = outboundFees.get(k);
        const that = di != null;
        let deliveryFee = 0, returnFee = 0;
        if (code === "SG") {
            // Thu hộ COD chỉ khi thu được tiền: % tiền đơn, có mức sàn. Hoàn: nhập kho hàng hoàn.
            deliveryFee = codFees.get(k) ?? Math.max(Number(f.cod_fee?.pct || 0) * codRmb, Number(f.cod_fee?.min || 0)) * COST_RATE_RMB_VND;
            returnFee = Number(f.returns?.return_inbound || 0) * COST_RATE_RMB_VND;
            di = di ?? estOutboundFee!;
        } else {
            // Nhật: phí ủy thác thu hộ thu DÙ khách có nhận hay không → vào phí chặng đi.
            // Hoàn = phí từ chối nhận (xử lý hàng hoàn).
            const jpCodFeeVnd = codFees.get(k) ?? (jpCodFee(s.cod_local, JP_FEE_SCHEDULE) ?? 0) * rLocal;
            di = (di ?? estOutboundFee!) + jpCodFeeVnd;
            returnFee = Number(f.refusal_fee_jpy || 0) * rLocal;
        }
        return {
            nuoc: code, ma: s.order_id || s.tracking, ngay: date, ngay_gui: s.ship_date || null, nhom: group,
            trang_thai: s.raw_status || s.status || "",
            cod_vnd: codVnd,
            cod_that_vnd: chuoi ? s.cod_local * chuoi.tw * chuoi.rv : null,
            gia_von_vnd: skuCogs(s.sku, s.quantity || 1),
            phi_di_vnd: di, phi_giao_vnd: deliveryFee, phi_hoan_vnd: returnFee, phi_that: that,
            hang_ve_kho: RESTOCKABLE_MARKETS.has(code),
            hoan_con_han: group === "hoan" && isWithinFreeStorage(s.ship_date, date, asOf, /tiêu hu/i.test(String(s.raw_status || "")) || s.status === "Destroyed"),
        };
    });

    const marketName = code === "SG" ? "Singapore" : "Nhật";
    return {
        kien: parcels,
        nguon: `Bảng đối tác ${marketName} + 17TRACK · sao kê NAZA ${marketName}`,
        co_so: [
            `Phí 3PL: phí thật từng kiện trong ${sk.statements.length} kỳ sao kê ${marketName} (vận chuyển + chặng đầu + thao tác${code === "SG" ? ", thu hộ COD" : ""}); kiện chưa có sao kê ước ${estimateMethod}.`,
            code === "SG"
                ? `Thu hộ COD ${(Number(f.cod_fee?.pct || 0) * 100).toFixed(0)}% (tối thiểu ${f.cod_fee?.min || 0} tệ) chỉ khi giao được; hàng hoàn mất phí đi + nhập kho hoàn ${f.returns?.return_inbound || 0} tệ, lưu tối đa 30 ngày rồi huỷ.`
                : `Phí thu hộ theo bậc tiền COD thu dù khách có nhận hay không; khách từ chối mất thêm ${fmt(Number(f.refusal_fee_jpy || 0))}¥, hàng về kho NAZA Nhật.`,
            chuoi
                ? `Chênh tỷ giá: NAZA quy ${code === "SG" ? "S$" : "¥"}→tệ ${chuoi.tw} × ${fmt(chuoi.rv)}đ/tệ (kỳ mới nhất) so với ${fmt(rLocal)}đ của Doanh số.`
                : `Chênh tỷ giá: chưa có kỳ sao kê nào ghi tỷ giá — tính theo ${fmt(rLocal)}đ.`,
            "Giá vốn: mã SP trong cột SKU bảng đối tác × bảng products.",
        ],
    };
}

// ─────────────────────────────────────────────────────────────────────────
// UAE — đơn POS + WeShip, bảng giá D&T Fulfillment
// ─────────────────────────────────────────────────────────────────────────
const POS_TO_STANDARD_STATUS: Record<string, string> = {
    GIAO_THANH_CONG: "Delivered", DON_HOAN: "Returned", HUY: "Cancelled", DANG_GIAO: "InTransit",
};

async function aeParcels(from: string, to: string, asOf: string): Promise<MarketSource> {
    const mk = trackMarket("AE");
    const windowStart = new Date(Date.parse(`${asOf}T00:00:00Z`) - (DELIVERY_RATE_CFG.cua_so_ngay + 30) * 86_400_000).toISOString().slice(0, 10);
    const startDate = from < windowStart ? from : windowStart;
    const [rows, store, orderCosts] = await Promise.all([
        query(
            `SELECT v.order_id, to_char(v.order_date, 'YYYY-MM-DD') AS order_date, v.status_name, v.status_category,
                    safe_divide(o.cod, NULLIF(v.pos_money_divisor, 0)) AS cod, o.partner, o.time_send_partner
             FROM vw_orders_std v
             LEFT JOIN sale_order o ON v.shop_id = o.shop_id AND v.order_id = o.id
             WHERE v.market = @m AND v.status_category NOT IN ('DON_THO')
               AND v.order_date BETWEEN @tu::date AND @den::date`,
            { m: mk.pos_market || "AE", tu: startDate, den: to },
        ),
        readStoreFresh<{ statuses: Record<string, { status?: string | null; sub_status?: string | null; raw_status?: string | null; source?: string }> }>(
            mk.store, { statuses: {} }),
        computeOrderCosts(from, to, (shop) => shop === "AE"),
    ]);
    const gv = new Map(orderCosts.don.map((d) => [d.key.replace(/^AE-/, ""), d]));
    const f = FEES.AE || {};
    const rAe = rate("AE");
    // Phí fulfillment theo bậc số đơn TRUNG BÌNH/NGÀY của kỳ đang xem (đơn hoàn cũng mất).
    const periodDays = Math.max(1, daysBetween(from, to) + 1);
    const periodOrders = (rows as any[]).filter((r) => r.order_date >= from && r.order_date <= to && r.status_category !== "HUY").length;
    const bac = [...(f.fulfillment_fee_tiers || [])].sort((a: any, b: any) => a.max_orders_per_day - b.max_orders_per_day);
    const fulfill = bac.length ? (bac.find((b: any) => periodOrders / periodDays < b.max_orders_per_day) || bac[bac.length - 1]).fee : 0;

    const parcels: Parcel[] = (rows as any[]).map((r) => {
        const awb = awbFromPartner(r.partner);
        const w = awb ? store.statuses[awb] : undefined;
        const ws = w?.source === "weship" ? w.status || null : null;
        // WeShip đã kết thúc thì tin WeShip; chưa thì POS (Lộc cập nhật giao/hoàn trên POS) — rồi mới tới WeShip dở dang.
        const pos = POS_TO_STANDARD_STATUS[String(r.status_category || "").toUpperCase()] || null;
        const st = ws && TERMINAL.has(ws) ? ws : pos && TERMINAL.has(pos) ? pos : ws || pos;
        const shipped = !!awb || !!r.time_send_partner || pos === "InTransit";
        const group = classifyParcel(st, ws ? w?.sub_status : null, ws ? w?.raw_status : null, shipped);
        const cod = Number(r.cod) || 0;
        const d = gv.get(String(r.order_id));
        return {
            nuoc: "AE", ma: String(r.order_id), ngay: String(r.order_date || ""), ngay_gui: null, nhom: group,
            trang_thai: (ws && w?.raw_status) || r.status_name || r.status_category || "",
            cod_vnd: cod * rAe, cod_that_vnd: null,
            gia_von_vnd: d ? (d.du ? d.cogs : null) : null,
            phi_di_vnd: fulfill * rAe,
            phi_giao_vnd: (Number(f.delivered_ship_fee || 0) + Number(f.cod_fee_pct || 0) * cod) * rAe,
            phi_hoan_vnd: Number(f.return_ship_fee || 0) * rAe,
            phi_that: false,
            hang_ve_kho: RESTOCKABLE_MARKETS.has("AE"),
        };
    });
    return {
        kien: parcels,
        nguon: "Đơn POS UAE + trạng thái WeShip",
        co_so: [
            `Phí 3PL: bảng giá D&T Fulfillment (chưa có sao kê) — fulfillment ${fulfill} AED/đơn (${(periodOrders / periodDays).toFixed(1)} đơn/ngày, đơn hoàn cũng mất) `
            + `+ vận chuyển đơn thành công ${f.delivered_ship_fee} AED + thu hộ ${(Number(f.cod_fee_pct || 0) * 100).toFixed(0)}% tiền đơn; đơn hoàn miễn phí vận chuyển.`,
            "Hàng hoàn về kho D&T bán tiếp được → đơn hoàn không mất giá vốn. Chưa trừ phí lưu kho "
            + `${f.storage_fee_aed_per_cbm_month ?? 75} AED/CBM/tháng (D&T thu khi hàng xuất mỗi ngày dưới 10% tồn kho) — chưa có số CBM hàng tồn.`,
            "Giá vốn: mã vạch hàng trên POS (đổi tên vẫn ra đúng món), không có thì tên hàng × markets.UAE.product_costs_vnd (tiền hàng + hộp).",
        ],
    };
}

/** Mọi kiện của một nước (cả kiện cũ ngoài kỳ — để đo tỉ lệ giao). */
export function loadMarketParcels(code: string, from: string, to: string, asOf: string): Promise<MarketSource> {
    if (code === "TW") return twParcels(asOf);
    if (code === "SG" || code === "JP") return partnerParcels(code, asOf);
    if (code === "AE") return aeParcels(from, to, asOf);
    return Promise.reject(new Error(`chưa có nguồn kiện cho ${code}`));
}
