import { NextRequest, NextResponse } from "next/server";
import { MARKETS_PUBLIC, REPORT_START_DATE } from "@/lib/talpha/rules";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { reportForRange } from "@/lib/talpha/team-summary-sheet";
import { todayVn } from "@/lib/talpha/order-ledger";
import { readStoreFresh } from "@/lib/talpha/store";
import {
    estimatePending3pl, emptyAmounts, allocateOpex, sumParcels, totalFees, computeDeliveryRate,
    type Pending3pl, type Amounts, type OpexItem, type ParcelTotals, type DeliveryRate,
} from "@/lib/talpha/income-statement";
import { DELIVERY_RATE_CFG, PENDING_3PL_DAYS, OPEX_CATEGORIES, loadMarketParcels } from "@/lib/talpha/income-statement-sources";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ═══════════════════════════════════════════════════════════════════
// LÃI LỖ — tab Kế toán → Lãi lỗ (04/11/2026). Cách tính: lib/talpha/income-statement.ts.
//
//   Doanh số · ads  ← file TỔNG TEAM (lib/talpha/team-summary-sheet.ts) — khớp tab Tổng quan
//   Kiện · giá vốn · phí 3PL ← lib/talpha/income-statement-sources.ts — cùng nguồn Sổ đơn, Tiền COD về
//   Chi phí vận hành ← data/operating_expenses.json (giám đốc nhập ở chính tab này)
//
// Ai đăng nhập có tab cũng xem được (Sỹ Anh chốt "tất cả"), nhưng chỉ nước của team mình.
// Chi phí CHUNG chia theo doanh số của MỌI nước — nên route đọc Sheet KHÔNG cắt team để lấy
// tỷ lệ chia, rồi chỉ trả nước người xem được. Từng khoản vận hành (tên, lương từng người)
// chỉ giám đốc thấy; người khác thấy tổng theo nước.
// ═══════════════════════════════════════════════════════════════════

type OpexStore = { items: OpexItem[] };
const OPEX_STORE = "operating_expenses";

type MarketRow = {
    code: string; ten: string;
    nguon: string; co_so: string[]; loi: string | null;
    don: number; doanh_so: number; ads: number;
    ty_le: DeliveryRate | null;
    tk: ParcelTotals | null;
    cho_len_3pl: Pending3pl | null;
    van_hanh: { rieng: number; chung: number };
    du_kien: Amounts; toi_thieu: Amounts;
    loi_nhuan: { du_kien: number; toi_thieu: number };
};

const accumulate = (a: Amounts, b: Amounts) => {
    a.doanh_thu += b.doanh_thu; a.gia_von += b.gia_von;
    a.phi.di += b.phi.di; a.phi.giao += b.phi.giao; a.phi.hoan += b.phi.hoan; a.phi.ty_gia += b.phi.ty_gia;
};

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const fromIn = sp.get("from") || "", to = sp.get("to") || "";
    if (!DATE_RE.test(fromIn) || !DATE_RE.test(to)) {
        return NextResponse.json({ error: "from/to phải dạng YYYY-MM-DD" }, { status: 400 });
    }
    const from = REPORT_START_DATE && fromIn < REPORT_START_DATE ? REPORT_START_DATE : fromIn;
    const a = await getAccess(req);
    if (!a) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
    const seesAll = seesAllMarkets(a);
    const today = todayVn();
    const asOf = to < today ? to : today;

    try {
        // Sheet KHÔNG cắt team: cần doanh số mọi nước để chia chi phí chung cho đúng.
        const [sheet, opexData] = await Promise.all([
            reportForRange(from, to, null),
            readStoreFresh<OpexStore>(OPEX_STORE, { items: [] }),
        ]);
        const activeMarkets = MARKETS_PUBLIC.markets.filter((m) => m.status === "active");
        const visibleMarkets = activeMarkets.filter((m) => seesAll || canMarket(a, m.code));
        const salesByMarket = Object.fromEntries(activeMarkets.map((m) => [m.code, sheet.markets.find((x) => x.code === m.code)?.doanh_so || 0]));
        const opexAllocation = allocateOpex(opexData.items || [], from, to, salesByMarket);

        const marketRows: MarketRow[] = await Promise.all(visibleMarkets.map(async (m): Promise<MarketRow> => {
            const s = sheet.markets.find((x) => x.code === m.code);
            const opex = opexAllocation.theo_nuoc[m.code] || { rieng: 0, chung: 0 };
            const base = {
                code: m.code, ten: m.display, don: s?.don || 0, doanh_so: s?.doanh_so || 0, ads: s?.ads || 0, van_hanh: opex,
            };
            try {
                const n = await loadMarketParcels(m.code, from, to, asOf);
                const deliveryRate = computeDeliveryRate(n.kien, asOf, DELIVERY_RATE_CFG);
                const periodParcels = n.kien.filter((k) => k.ngay >= from && k.ngay <= to);
                const parcelTotals = sumParcels(periodParcels, deliveryRate.r);
                // UAE: kiện chính là đơn POS — không có độ trễ lên 3PL.
                const awaiting3pl = m.code === "AE" ? null : estimatePending3pl(
                    sheet.market_days.filter((d) => d.code === m.code && d.date >= from && d.date <= to),
                    periodParcels, deliveryRate.r, today, PENDING_3PL_DAYS);
                const expected = emptyAmounts(); accumulate(expected, parcelTotals.du_kien); if (awaiting3pl) accumulate(expected, awaiting3pl.khoan);
                const minimum = emptyAmounts(); accumulate(minimum, parcelTotals.toi_thieu);
                const marketOpex = opex.rieng + opex.chung;
                return {
                    ...base, nguon: n.nguon, co_so: n.co_so, loi: null, ty_le: deliveryRate, tk: parcelTotals, cho_len_3pl: awaiting3pl, du_kien: expected, toi_thieu: minimum,
                    loi_nhuan: {
                        du_kien: expected.doanh_thu - expected.gia_von - totalFees(expected.phi) - base.ads - marketOpex,
                        toi_thieu: minimum.doanh_thu - minimum.gia_von - totalFees(minimum.phi) - base.ads - marketOpex,
                    },
                };
            } catch (e: any) {
                console.error(`lai-lo ${m.code}:`, e?.message || e);
                // Không đọc được kiện của nước này: không bịa doanh thu — lãi để null ở giao diện.
                return {
                    ...base, nguon: "", co_so: [], loi: e?.message || String(e), ty_le: null, tk: null, cho_len_3pl: null,
                    du_kien: emptyAmounts(), toi_thieu: emptyAmounts(), loi_nhuan: { du_kien: NaN, toi_thieu: NaN },
                };
            }
        }));

        // Phần của file TỔNG TEAM không thuộc nước đang bán nào (camp nước sắp chạy, nước đã
        // dừng…) — chỉ người xem hết mới thấy, và nó vẫn phải trừ vào lãi cả công ty.
        const marketsTotal = marketRows.reduce((s, d) => ({ ads: s.ads + d.ads, doanh_so: s.doanh_so + d.doanh_so, don: s.don + d.don }), { ads: 0, doanh_so: 0, don: 0 });
        const outsideMarkets = seesAll ? {
            ads: Math.max(0, sheet.team.ads - marketsTotal.ads),
            doanh_so: Math.max(0, sheet.team.doanh_so - marketsTotal.doanh_so),
            don: Math.max(0, sheet.team.don - marketsTotal.don),
        } : null;
        const unallocatedOpex = seesAll ? opexAllocation.chung_chua_chia : 0;
        // Khoản riêng của nước KHÔNG đang bán (khai nhầm, nước đã dừng) — vẫn là tiền công ty bỏ ra.
        const otherMarketsOpex = seesAll ? Object.entries(opexAllocation.theo_nuoc)
            .filter(([c]) => !activeMarkets.some((m) => m.code === c))
            .reduce((s, [, v]) => s + v.rieng + v.chung, 0) : 0;

        const ok = marketRows.filter((d) => !d.loi);
        const expected = emptyAmounts(), minimum = emptyAmounts();
        for (const d of ok) { accumulate(expected, d.du_kien); accumulate(minimum, d.toi_thieu); }
        const ads = marketsTotal.ads + (outsideMarkets?.ads || 0);
        const totalOpex = marketRows.reduce((s, d) => s + d.van_hanh.rieng + d.van_hanh.chung, 0) + unallocatedOpex + otherMarketsOpex;
        const total = {
            don: marketsTotal.don + (outsideMarkets?.don || 0),
            doanh_so: marketsTotal.doanh_so + (outsideMarkets?.doanh_so || 0),
            ads, van_hanh: totalOpex,
            doanh_thu_chac: ok.reduce((s, d) => s + (d.tk?.doanh_thu_chac || 0), 0),
            du_kien: expected, toi_thieu: minimum,
            loi_nhuan: {
                du_kien: expected.doanh_thu - expected.gia_von - totalFees(expected.phi) - ads - totalOpex,
                toi_thieu: minimum.doanh_thu - minimum.gia_von - totalFees(minimum.phi) - ads - totalOpex,
            },
            // Nước đọc kiện lỗi: lãi tổng THIẾU phần nước đó — giao diện phải báo.
            thieu_nuoc: marketRows.filter((d) => d.loi).map((d) => d.code),
        };

        return NextResponse.json({
            from, to, as_of: asOf, hom_nay: today, scoped: !seesAll,
            missing_months: sheet.missing_months,
            cfg: { delivery_rate: DELIVERY_RATE_CFG, await_3pl_days: PENDING_3PL_DAYS, opex_groups: OPEX_CATEGORIES },
            nuoc: marketRows.map((d) => ({
                ...d,
                loi_nhuan: { du_kien: Number.isFinite(d.loi_nhuan.du_kien) ? d.loi_nhuan.du_kien : null, toi_thieu: Number.isFinite(d.loi_nhuan.toi_thieu) ? d.loi_nhuan.toi_thieu : null },
            })),
            ngoai_nuoc: outsideMarkets && (outsideMarkets.ads > 0 || outsideMarkets.doanh_so > 0) ? outsideMarkets : null,
            tong: total,
            van_hanh: {
                ghi_duoc: a.full,
                // Từng khoản (tên người, lương) chỉ giám đốc; người khác chỉ thấy tổng theo nước.
                items: a.full ? (opexData.items || []) : [],
                trong_ky: a.full ? opexAllocation.chi_tiet : [],
                chung: seesAll ? opexAllocation.chung : null,
                chung_chua_chia: unallocatedOpex,
                nuoc_khac: otherMarketsOpex,
            },
            nuoc_ban: activeMarkets.map((m) => ({ code: m.code, ten: m.display })),
        });
    } catch (e: any) {
        console.error("lai-lo:", e?.message || e);
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
