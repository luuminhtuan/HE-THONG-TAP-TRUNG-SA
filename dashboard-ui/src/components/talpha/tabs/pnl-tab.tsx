"use client";

import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { formatVNDCompact, formatMoney, formatNumber, marketName, cn } from "../utils";
import { useMarkets } from "../markets-context";
import { scopeLabel, useAccess } from "../access-context";
import {
    ReportHero, KpiRow, KpiTile, ResultCard, WaterfallList, BarStrip,
    ReportTable, FootNotes, DASH,
    type Column,
} from "../report";
import { expectedByDeliveryRate, type MarketDeliveryRate } from "@/lib/talpha/pnl-expected";

/*
 * P&L — cùng nền với tab Tổng quan (Sỹ Anh chốt 25/09/2026).
 *
 * Doanh số · tiền ads · số đơn: file TỔNG TEAM (/api/talpha/sheet-report?from&to).
 * Giá vốn · phí ship: /api/talpha/pnl-costs — hai khoản Sheet không có, tính trên cùng
 * tập đơn đã chốt. Trước đây tab tính trên đơn ĐÃ GIAO XONG từ BigQuery và không trừ giá
 * vốn: 15/09 → 25/09 ra 5 đơn, DS 5,9tr, lỗ −16,6tr — trong khi Sheet ra 110 đơn, 144tr.
 */

interface Props { dateRange?: { from: Date; to: Date }; projectId?: string }

interface Metrics { ads: number; mess: number; don: number; doanh_so: number; ds_giao_tc: number }
interface SheetReport {
    from: string; to: string; start_date: string | null;
    missing_months: string[];
    team: Metrics;
    markets: (Metrics & { tab: string; code: string | null })[];
    days: (Metrics & { date: string })[];
    market_days?: (Metrics & { code: string; date: string })[];
}
interface CostBucket { orders: number; cogs_vnd: number; orders_cogs_full: number; ship_vnd: number; orders_no_ship: number }
interface Costs {
    total: CostBucket;
    days: (CostBucket & { date: string })[];
    markets: (CostBucket & { code: string; ship_per_order_vnd: number | null })[];
    market_days?: (CostBucket & { code: string; date: string })[];
    /** Tỉ lệ giao thành công từng nước (theo tiền COD) — cùng thước Kế toán → Lãi lỗ. */
    delivery_rates?: Record<string, MarketDeliveryRate>;
    /** Nước hàng hoàn về kho bán tiếp — đơn hoàn không mất giá vốn. */
    restock_markets?: string[];
    /** Mã shop → câu giải thích phí ship của nước đó được ước tính từ đâu. */
    ship_basis: Record<string, string>;
    missing_costs: { ma: string; ten: string; qty: number; orders: number }[];
    cost_rate_rmb_vnd: number;
}

type Row = {
    key: string; label: string; don: number; doanh_so: number;
    /** Tỉ lệ giao thành công áp cho dòng (null = chưa đo được → coi giao hết). */
    rate: number | null; revenue: number;
    ads: number; ship: number; cogs: number; lai: number; ghiChu?: string;
};

const emptyCost = (): CostBucket => ({ orders: 0, cogs_vnd: 0, orders_cogs_full: 0, ship_vnd: 0, orders_no_ship: 0 });
const formatDmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pctText = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : DASH);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatMoney(n)}`;

async function fetchJson<T>(url: string): Promise<T> {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
    return d as T;
}

export default function TALPHAPnLTab({ dateRange }: Props) {
    const [loading, setLoading] = useState(true);
    const [sheet, setSheet] = useState<SheetReport | null>(null);
    const [costs, setCosts] = useState<Costs | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [costError, setCostError] = useState<string | null>(null);
    const { loaded: marketsLoaded } = useMarkets();
    const scope = scopeLabel(useAccess());

    useEffect(() => {
        let cancelled = false;
        const from = format(dateRange?.from ?? new Date(), "yyyy-MM-dd");
        const to = format(dateRange?.to ?? new Date(), "yyyy-MM-dd");
        setLoading(true); setError(null); setCostError(null);
        Promise.allSettled([
            fetchJson<SheetReport>(`/api/talpha/sheet-report?from=${from}&to=${to}`),
            fetchJson<Costs>(`/api/talpha/pnl-costs?from=${from}&to=${to}&delivery_rate=1`),
        ]).then(([s, c]) => {
            if (cancelled) return;
            if (s.status === "fulfilled") setSheet(s.value); else { setSheet(null); setError(String(s.reason?.message || s.reason)); }
            // Không đọc được chi phí thì vẫn hiện doanh số và ads — chỉ ghi rõ là thiếu.
            if (c.status === "fulfilled") setCosts(c.value); else { setCosts(null); setCostError(String(c.reason?.message || c.reason)); }
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [dateRange]);

    if (loading || !marketsLoaded) return <TabSkeleton cards={6} showChart={true} rows={5} />;

    if (error || !sheet) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                <p className="font-semibold">Không đọc được file TỔNG TEAM.</p>
                <p className="mt-1">{error}</p>
            </div>
        );
    }

    const t = sheet.team;
    const c = costs?.total ?? emptyCost();
    const ship = c.ship_vnd;
    const today = format(new Date(), "yyyy-MM-dd");
    const period = `${formatDmy(sheet.from)} → ${formatDmy(sheet.to)}`;

    // ── Tỉ lệ giao thành công (11/11/2026) — cách tính ở lib/talpha/pnl-expected.ts (chung Tổng quan).
    const rates = costs?.delivery_rates || {};
    const expected = expectedByDeliveryRate({
        markets: sheet.markets, days: sheet.days, market_days: sheet.market_days,
        cost_days: costs?.days, cost_market_days: costs?.market_days,
        delivery_rates: costs?.delivery_rates, restock_markets: costs?.restock_markets,
    });
    const { avgRate, rateFor, cogsAfterReturns } = expected;

    // Theo nước: tab nước của Sheet + chi phí cùng mã shop.
    const costByMarket = new Map((costs?.markets || []).map(m => [m.code, m]));
    const marketRows: Row[] = sheet.markets.map(m => {
        const k = (m.code && costByMarket.get(m.code)) || { ...emptyCost(), ship_per_order_vnd: null };
        const notes: string[] = [];
        const mr = m.code ? rates[m.code] : undefined;
        if (costs && (!mr || mr.r == null)) notes.push(avgRate != null ? "chưa đo được tỉ lệ giao — lấy bình quân" : "chưa đo được tỉ lệ giao");
        else if (mr?.tam) notes.push("tỉ lệ giao tạm (mẫu ít)");
        if (k.ship_per_order_vnd == null && k.orders > 0) notes.push("chưa có phí ship");
        if (k.orders_cogs_full < k.orders) notes.push(`${k.orders - k.orders_cogs_full} đơn thiếu giá vốn`);
        const rate = rateFor(m.code);
        const revenue = m.doanh_so * rate;
        const cogs = m.code ? cogsAfterReturns(m.code, k.cogs_vnd) : k.cogs_vnd;
        return {
            key: m.tab, label: m.code ? marketName(m.code) : m.tab, don: m.don, doanh_so: m.doanh_so,
            rate: costs ? rate : null, revenue, ads: m.ads,
            ship: k.ship_vnd, cogs, lai: revenue - m.ads - k.ship_vnd - cogs,
            ghiChu: notes.join(" · ") || undefined,
        };
    });

    // Theo ngày: doanh số/ads/đơn từ Sheet, ship từ pnl-costs; DT + giá vốn dự kiến từ `expected`.
    const costByDate = new Map((costs?.days || []).map(d => [d.date, d]));
    const dailyRows: Row[] = [...sheet.days].reverse().map(d => {
        const k = costByDate.get(d.date) ?? emptyCost();
        const x = expected.byDay.get(d.date) ?? { revenue: d.doanh_so, cogs: k.cogs_vnd };
        return {
            key: d.date, label: formatDmy(d.date), don: d.don, doanh_so: d.doanh_so,
            rate: costs && d.doanh_so > 0 ? x.revenue / d.doanh_so : null, revenue: x.revenue, ads: d.ads,
            ship: k.ship_vnd, cogs: x.cogs, lai: x.revenue - d.ads - k.ship_vnd - x.cogs,
        };
    });

    const { revenue, cogs, periodRate } = expected;
    const profit = revenue - t.ads - ship - cogs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : null;
    const marketsMissingRate = costs ? sheet.markets.filter(m => m.code && rates[m.code]?.r == null) : [];

    // Những thứ còn thiếu để P&L đủ — đọc thẳng từ số liệu, không liệt kê cứng.
    const marketsMissingShip = (costs?.markets || []).filter(m => m.ship_per_order_vnd == null && m.orders > 0);
    const missingCogs = costs?.missing_costs || [];
    const ordersMissingCogs = c.orders - c.orders_cogs_full;
    const orderCountMismatch = costs && c.orders !== t.don;

    return (
        <div className="space-y-6">
            <ReportHero
                emoji="💰"
                title={`P&L${scope ? ` team ${scope}` : ""} — ${period}`}
                subtitle={
                    <>
                        Doanh số, tiền ads, số đơn lấy thẳng từ file <strong>TỔNG TEAM</strong> (khớp tab Tổng quan).
                        Giá vốn tính theo mã sản phẩm trên đơn POS × bảng &ldquo;Giá tới Taiwan&rdquo;; phí ship ước tính — Đài theo
                        trung bình các kỳ sao kê NAZA, Singapore theo bảng giá 3PL
                        {sheet.start_date && <> · tính từ <strong>{formatDmy(sheet.start_date)}</strong></>}.
                        {" "}Doanh thu dự kiến = doanh số × <strong>tỉ lệ giao thành công</strong> thật của từng nước (đo theo tiền COD trên
                        kiện đã có kết quả, lên đơn 90→21 ngày trước — cùng thước Kế toán → Lãi lỗ). Lợi nhuận đủ mọi khoản (phí 3PL thật,
                        chi phí vận hành) xem ở <strong>Kế toán → Lãi lỗ</strong>.
                    </>
                }
            />

            {(sheet.missing_months.length > 0 || costError) && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    {sheet.missing_months.length > 0 && <p>Thiếu số tháng {sheet.missing_months.join(", ")} — vòng báo cáo (phút :20 mỗi giờ) chưa ghi số tháng đó.</p>}
                    {costError && <p>Không tính được giá vốn và phí ship ({costError}) — hai khoản đó đang để 0.</p>}
                </div>
            )}

            <KpiRow>
                <KpiTile emoji="💵" label="Doanh số" value={formatVNDCompact(t.doanh_so)} sub={`${formatNumber(t.don)} đơn đã chốt`}
                    tooltip="Cột Doanh Số của file TỔNG TEAM: mọi đơn đã chốt trên POS, trừ huỷ, nháp, đơn trống." />
                <KpiTile emoji="🎯" label="Doanh thu dự kiến" value={formatVNDCompact(revenue)}
                    sub={periodRate == null ? DASH : `giao thành công ${(periodRate * 100).toFixed(1)}%`}
                    tone={marketsMissingRate.length ? "warn" : "neutral"}
                    tooltip="Doanh số × tỉ lệ giao thành công của từng nước. Phần còn lại là tiền đơn hoàn dự kiến — không thu về." />
                <KpiTile emoji="💸" label="Tiền ads" value={formatVNDCompact(t.ads)} sub={`${pctText(t.ads, t.doanh_so)} doanh số`} />
                <KpiTile emoji="🚚" label="Phí ship" value={formatVNDCompact(ship)}
                    sub={marketsMissingShip.length ? `thiếu ${marketsMissingShip.map(m => marketName(m.code)).join(", ")}` : `${pctText(ship, t.doanh_so)} doanh số`}
                    tone={marketsMissingShip.length ? "warn" : "neutral"}
                    tooltip="Ước tính = số đơn × phí trung bình một kiện trong các kỳ sao kê NAZA. Nước chưa có sao kê thì chưa tính." />
                <KpiTile emoji="📦" label="Giá vốn" value={formatVNDCompact(cogs)}
                    sub={ordersMissingCogs > 0 ? `${formatNumber(ordersMissingCogs)} đơn thiếu giá` : `${pctText(cogs, t.doanh_so)} doanh số`}
                    tone={ordersMissingCogs > 0 ? "warn" : "neutral"}
                    tooltip="Mã 3 số trong tên sản phẩm POS × giá tệ trong bảng Giá tới Taiwan (talpha_rules.json → products)." />
                <KpiTile emoji="📊" label="Lãi gộp dự kiến" value={formatVNDCompact(profit)} sub={margin === null ? DASH : `biên ${margin.toFixed(1)}% doanh thu`}
                    tone={profit >= 0 ? "good" : "bad"}
                    tooltip="Doanh thu dự kiến (đã trừ hoàn theo tỉ lệ giao) − ads − phí ship − giá vốn. Chưa trừ chi phí vận hành." />
                <KpiTile emoji="✅" label="Đã giao xong" value={formatVNDCompact(t.ds_giao_tc)} sub={`${pctText(t.ds_giao_tc, t.doanh_so)} doanh số`}
                    tooltip="DS giao TC của Sheet — phần doanh số đã giao thành công, tiền chắc chắn về." />
            </KpiRow>

            <ResultCard
                emoji="💰"
                title="Lãi gộp kỳ này (dự kiến)"
                note="Đã trừ đơn hoàn theo tỉ lệ giao thành công thật của từng nước. Đơn hoàn vẫn mất phí ship và giá vốn (trừ UAE: hàng hoàn về kho D&T bán tiếp). Chưa trừ chi phí vận hành (lương, phần mềm, kho)."
                value={signed(profit)}
                caption={margin === null ? "chưa có doanh số" : `biên ${margin.toFixed(1)}% trên doanh thu dự kiến`}
                tone={profit >= 0 ? "good" : "bad"}
                segments={[
                    { color: "bg-slate-400", value: Math.max(0, t.doanh_so - revenue), label: "Hoàn dự kiến" },
                    { color: "bg-rose-400", value: t.ads, label: "Tiền ads" },
                    { color: "bg-amber-400", value: ship, label: "Phí ship" },
                    { color: "bg-sky-400", value: cogs, label: "Giá vốn" },
                    { color: "bg-emerald-500", value: Math.max(0, profit), label: "Lãi gộp" },
                ]}
            >
                <WaterfallList
                    rows={[
                        { label: "Doanh số (đơn đã chốt)", value: formatMoney(t.doanh_so), kind: "base" },
                        { label: "Đơn hoàn dự kiến", hint: periodRate == null ? "chưa đo được tỉ lệ giao" : `giao thành công ${(periodRate * 100).toFixed(1)}% → hoàn ${((1 - periodRate) * 100).toFixed(1)}%`, value: formatMoney(t.doanh_so - revenue), kind: "minus" },
                        { label: "Tiền ads", value: formatMoney(t.ads), kind: "minus" },
                        marketsMissingShip.length && !ship
                            ? { label: "Phí ship", hint: "chưa có sao kê 3PL", value: DASH, kind: "minus", missing: true }
                            : { label: "Phí ship", hint: marketsMissingShip.length ? `ước tính · thiếu ${marketsMissingShip.map(m => marketName(m.code)).join(", ")}` : "ước tính — Đài theo sao kê NAZA, Singapore theo bảng giá", value: formatMoney(ship), kind: "minus" },
                        { label: "Giá vốn", hint: ordersMissingCogs > 0 ? `thiếu giá ${formatNumber(ordersMissingCogs)} đơn` : "đơn hoàn vẫn mất, trừ UAE (về kho bán tiếp)", value: formatMoney(cogs), kind: "minus" },
                        { label: "Chi phí vận hành", hint: "chưa khai", value: DASH, kind: "minus", missing: true },
                        { label: "Lãi gộp dự kiến", value: signed(profit), kind: "total" },
                    ]}
                />
            </ResultCard>

            {/* ═══ Còn thiếu gì để P&L tính đủ ═══ */}
            {(missingCogs.length > 0 || marketsMissingShip.length > 0 || orderCountMismatch || marketsMissingRate.length > 0) && (
                <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
                    <h3 className="section-header mb-2">🧩 Còn thiếu để tính đủ</h3>
                    <ul className="space-y-2 text-sm text-foreground">
                        {missingCogs.length > 0 && (
                            <li>
                                <strong>Giá vốn</strong> — {formatNumber(missingCogs.length)} mã chưa có giá tệ trong bảng &ldquo;Giá tới Taiwan&rdquo;
                                ({formatNumber(ordersMissingCogs)} đơn đang tính thiếu giá vốn):
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {missingCogs.map(m => (
                                        <span key={m.ma} className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs dark:border-amber-500/30 dark:bg-transparent"
                                            title={`${m.qty} cái · ${m.orders} đơn`}>
                                            {m.ten} <span className="text-muted-foreground">({m.orders} đơn)</span>
                                        </span>
                                    ))}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Mã 3 số: gửi giá tệ để khai vào <code className="rounded bg-muted px-1">talpha_rules.json → products</code>.
                                    Dòng không có mã (tên tự gõ trên POS) thì sửa tên sản phẩm trên POS cho có mã.
                                </p>
                            </li>
                        )}
                        {marketsMissingRate.map(m => (
                            <li key={`r-${m.code}`}>
                                <strong>Tỉ lệ giao {marketName(m.code!)}</strong> — chưa đo được ({rates[m.code!]?.error || "chưa có kiện nào giao/hoàn xong"}),
                                đang lấy {avgRate != null ? `bình quân các nước ${(avgRate * 100).toFixed(1)}%` : "100% (coi giao hết)"}.
                            </li>
                        ))}
                        {marketsMissingShip.map(m => (
                            <li key={m.code}>
                                <strong>Phí ship {marketName(m.code)}</strong> — {formatNumber(m.orders)} đơn chưa tính ship: chưa có kỳ sao kê 3PL
                                nào của nước này. Khai bảng giá vào <code className="rounded bg-muted px-1">talpha_rules.json → shipping_fees</code> hoặc tải sao kê đầu tiên ở tab Đối soát COD thì P&L tự tính.
                            </li>
                        ))}
                        {orderCountMismatch && (
                            <li>
                                <strong>Số đơn</strong> — giá vốn và ship tính trên {formatNumber(c.orders)} đơn POS, Sheet đếm {formatNumber(t.don)} đơn
                                (Sheet bỏ đơn của người ngoài team, ô không gán và camp test).
                            </li>
                        )}
                    </ul>
                </section>
            )}

            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h3 className="section-header mb-1">📈 Lãi gộp theo ngày</h3>
                <BarStrip
                    hint="Tầng trên là doanh số, tầng dưới là lãi gộp dự kiến (xanh) hoặc lỗ (đỏ) của ngày đó. Cột mờ có gạch chéo = hôm nay, chưa hết ngày."
                    items={[...dailyRows].reverse().map(r => ({
                        label: r.label.slice(0, 5),
                        top: r.doanh_so,
                        bottom: r.lai,
                        inProgress: r.key === today,
                        title: `${r.label} · DS ${formatMoney(r.doanh_so)} · DT dự kiến ${formatMoney(r.revenue)} · ads ${formatMoney(r.ads)} · lãi ${signed(r.lai)}`,
                    }))}
                    legend={[
                        { color: "bg-emerald-500/70", label: "doanh số" },
                        { color: "bg-sky-500/70", label: "lãi gộp" },
                        { color: "bg-rose-500/70", label: "lỗ" },
                    ]}
                />
            </section>

            <ReportTable
                emoji="🌍"
                title="P&L theo thị trường"
                note="Doanh số và tiền ads theo tab từng nước của file TỔNG TEAM; doanh thu dự kiến = doanh số × tỉ lệ giao thành công của nước; giá vốn và ship theo shop POS của nước đó."
                columns={buildColumns("Thị trường")}
                rows={marketRows}
                rowKey={r => r.key}
                empty="Kỳ này chỉ một nước có số — Sheet không tách tab theo nước"
            />

            <ReportTable
                emoji="📅"
                title={`P&L theo ngày (${dailyRows.length} ngày)`}
                columns={buildColumns("Ngày")}
                rows={dailyRows}
                rowKey={r => r.key}
                empty="Chưa có ngày nào có số trong khoảng này"
                footer={<TotalRow cells={[
                    "TỔNG", formatNumber(t.don), formatMoney(t.doanh_so), periodRate == null ? DASH : `${(periodRate * 100).toFixed(1)}%`,
                    formatMoney(revenue), formatMoney(t.ads), formatMoney(ship),
                    formatMoney(cogs), signed(profit), margin === null ? DASH : `${margin.toFixed(1)}%`,
                ]} lai={profit} />}
            />

            <FootNotes
                warning={
                    <>
                        <strong>Đây là lãi gộp dự kiến.</strong> Đơn hoàn ước theo tỉ lệ giao thành công của từng nước, chưa trừ chi phí vận hành.
                        Phí ship là ước tính trung bình, không phải phí từng đơn — phí thật từng đơn xem ở Sổ đơn hàng khi đã có sao kê.
                    </>
                }
                notes={[
                    <>Doanh số, tiền ads, số đơn: file TỔNG TEAM, cùng số với tab Tổng quan và bot Zalo.</>,
                    ...Object.entries(rates).filter(([, v]) => v.r != null).map(([code, v]) => (
                        <>Tỉ lệ giao {marketName(code)}: {(v.r! * 100).toFixed(1)}% theo tiền COD — {v.giao} kiện giao, {v.hoan} kiện hoàn
                            {v.tu && v.den ? ` (lên đơn ${formatDmy(v.tu)} → ${formatDmy(v.den)})` : ""}{v.tam ? " · mẫu ít, số còn trôi" : ""}.</>
                    )),
                    ...(Object.keys(costs?.ship_basis || {}).length
                        ? Object.entries(costs!.ship_basis).map(([code, description]) => <>Phí ship {marketName(code)}: {description}</>)
                        : [<>Phí ship: chưa có sao kê hay bảng giá 3PL nào nên chưa ước tính được.</>]),
                    <>Giá vốn: mã 3 số trong tên sản phẩm POS × giá tệ trong <code className="rounded bg-muted px-1 py-0.5 text-[11px]">talpha_rules.json → products</code>,
                        quy VND theo {formatMoney(costs?.cost_rate_rmb_vnd ?? 0)}đ/tệ. Mã chưa khai giá không được coi là 0 — liệt kê ở khung &ldquo;Còn thiếu&rdquo;.</>,
                ]}
            />
        </div>
    );
}

function TotalRow({ cells, lai: profit }: { cells: ReactNode[]; lai: number }) {
    return (
        <tr className="border-t-2 border-amber-500/30 bg-amber-500/5 font-bold">
            {cells.map((c, i) => (
                <td key={i} className={cn("px-3 py-2 tabular-nums", i === 0 ? "text-left" : "text-right",
                    i === 8 && (profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"))}>
                    {c}
                </td>
            ))}
        </tr>
    );
}

const profitClass = (n: number) => (n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400");

const buildColumns = (firstLabel: string): Column<Row>[] => [
    {
        key: "label", label: firstLabel, cellClassName: "font-medium text-foreground",
        render: r => (
            <span className="flex flex-col">
                {r.label}
                {r.ghiChu && <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400">{r.ghiChu}</span>}
            </span>
        ),
    },
    { key: "don", label: "Đơn", align: "right", render: r => formatNumber(r.don) },
    { key: "doanh_so", label: "Doanh số", align: "right", render: r => formatMoney(r.doanh_so) },
    { key: "rate", label: "Tỉ lệ giao", align: "right", render: r => (r.rate == null ? DASH : `${(r.rate * 100).toFixed(1)}%`) },
    { key: "revenue", label: "DT dự kiến", align: "right", render: r => formatMoney(r.revenue) },
    { key: "ads", label: "Tiền ads", align: "right", render: r => formatMoney(r.ads) },
    { key: "ship", label: "Phí ship", align: "right", render: r => (r.ship > 0 ? formatMoney(r.ship) : DASH) },
    { key: "cogs", label: "Giá vốn", align: "right", render: r => (r.cogs > 0 ? formatMoney(r.cogs) : DASH) },
    { key: "lai", label: "Lãi gộp", align: "right", cellClassName: r => cn("font-semibold", profitClass(r.lai)), render: r => signed(r.lai) },
    { key: "bien", label: "Biên", align: "right", render: r => pctText(r.lai, r.revenue) },
];
