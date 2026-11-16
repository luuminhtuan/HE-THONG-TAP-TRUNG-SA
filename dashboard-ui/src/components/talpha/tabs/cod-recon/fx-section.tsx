import { BadgeCheck, ChevronDown, Info } from "lucide-react";
import {
    ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { cn } from "../../utils";
import { VND } from "../ledger-shared";
import type { Currency, Fx, FxRow } from "./types";
import { dmy, TW_CURRENCY } from "./format";
import { Kpi, Section } from "./ui";

/** ④ Tỷ giá đã lấy của mình bao nhiêu — dùng chung màn Đài và các nước khác (08/10/2026). */
export function FxSection({ so: figure, fx, kyDangXem: viewedFile, te: currency }: { so: string; fx: Fx; kyDangXem?: string; te: Currency }) {
    return (
        <Section so={figure} ten="Tỷ giá đã lấy của mình bao nhiêu" phamVi="all" gap={{ mo: false }}
            dem={fx.total_thiet_vnd > 0 ? `thiệt ${VND(fx.total_thiet_vnd)}` : undefined}>
            <div className="grid gap-px border-b border-border/70 bg-border/60 sm:grid-cols-3">
                <Kpi label="Thiệt vì tỷ giá" value={VND(fx.total_thiet_vnd)}
                    sub={`qua ${fx.rows.filter((r) => r.thiet_vnd != null).length} kỳ đã có sao kê`} tone="red" />
                <Kpi label="Tỷ giá tốt nhất NAZA từng đặt"
                    value={fx.best_vnd_per_twd != null ? `${fx.best_vnd_per_twd.toFixed(2)}đ/${currency.ky}` : "—"}
                    sub={fx.best_period ? `kỳ chốt ${dmy(fx.best_period)}` : ""} tone="green" />
                <WorstPeriodKpi rows={fx.rows} />
            </div>
            <p className="flex items-start gap-2 border-b border-border/70 bg-muted/30 px-5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 flex-none" />
                <span>
                    Tỷ giá NAZA tự đặt, mình phải chịu — nên chỉ hỏi: <b className="font-semibold text-foreground">nó đã lấy của mình bao nhiêu tiền</b>.
                    Mốc là kỳ tốt nhất chính NAZA từng đặt; tiền thiệt = chênh đồng/{currency.ky} × tiền COD cả kỳ. Rê chuột lên từng kỳ để xem số.
                </span>
            </p>
            <FxChart fx={fx} kyDangXem={viewedFile} te={currency} />
            <details className="group border-t border-border/70">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-5 py-2.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    Xem bảng số từng kỳ
                </summary>
                <div className="overflow-x-auto border-t border-border/70">
                    <table className="w-full min-w-[720px] whitespace-nowrap text-[13px]">
                        <thead>
                            <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                <th className="px-5 py-2.5 text-left">Kỳ chốt</th>
                                <th className="px-3 py-2.5 text-right">{currency.ma}→RMB</th>
                                <th className="px-3 py-2.5 text-right">RMB→VND</th>
                                <th className="px-3 py-2.5 text-right">Đồng / {currency.ky}</th>
                                <th className="px-3 py-2.5 text-right">Tiền COD</th>
                                <th className="px-5 py-2.5 text-right">Thiệt so kỳ tốt nhất</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                            {(() => {
                                const maxLoss = Math.max(0, ...fx.rows.map((r) => r.thiet_vnd ?? 0));
                                return fx.rows.map((r) => (
                                    <tr key={r.filename}
                                        className={cn("transition-colors",
                                            r.filename === viewedFile ? "bg-orange-50/70 dark:bg-orange-500/[0.07]" : "hover:bg-muted/30")}>
                                        <td className="px-5 py-2.5 font-semibold tabular-nums text-foreground">{dmy(r.period_date)}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 dark:text-sky-300">{r.rate_twd_rmb ?? "—"}</td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-violet-700 dark:text-violet-300">{r.rate_rmb_vnd ?? "—"}</td>
                                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                                            {r.vnd_per_twd != null ? r.vnd_per_twd.toFixed(2) : "—"}
                                        </td>
                                        <td className="px-3 py-2.5 text-right tabular-nums text-foreground/80">{currency.fmt(r.cod_twd)}</td>
                                        <td className="px-5 py-2.5 text-right">
                                            {r.thiet_vnd == null ? <span className="text-muted-foreground">—</span>
                                                : r.tot_nhat ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                        <BadgeCheck className="h-3.5 w-3.5" />tốt nhất
                                                    </span>
                                                ) : (
                                                    <div className="flex items-center justify-end gap-3">
                                                        <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-rose-100 sm:block dark:bg-rose-500/15">
                                                            <span className="block h-full rounded-full bg-rose-500"
                                                                style={{ width: `${maxLoss > 0 ? Math.max(4, (r.thiet_vnd / maxLoss) * 100) : 0}%` }} />
                                                        </span>
                                                        <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                                                            −{VND(r.thiet_vnd)}
                                                        </span>
                                                    </div>
                                                )}
                                        </td>
                                    </tr>
                                ));
                            })()}
                        </tbody>
                    </table>
                </div>
            </details>
        </Section>
    );
}

function WorstPeriodKpi({ rows }: { rows: FxRow[] }) {
    const w = rows.filter((r) => r.thiet_vnd != null && !r.tot_nhat)
        .sort((a, b) => (b.thiet_vnd ?? 0) - (a.thiet_vnd ?? 0))[0];
    return (
        <Kpi label="Kỳ tệ nhất" value={w ? VND(w.thiet_vnd ?? 0) : "—"}
            sub={w ? `kỳ chốt ${dmy(w.period_date)}` : "chưa đủ kỳ để so"} tone={w ? "cho" : undefined} />
    );
}

/* ④ Tỷ giá qua các kỳ — MỘT đường, MỘT trục.
   Đường = đồng thực nhận trên mỗi NT$ (tích hai chặng). Nét đứt = kỳ tốt nhất chính
   NAZA từng đặt. Vùng đỏ giữa hai đường = phần tỷ giá lấy của mình. Tiền thiệt từng
   kỳ còn tuỳ tiền COD kỳ đó nên nằm trong ô rê chuột, không in lên từng điểm.
   Màu đã chạy bộ kiểm mù màu: xanh–đỏ đạt, xanh lá–đỏ KHÔNG đạt (ΔE 5,8) — nên mốc
   tốt nhất là nét đứt xám có nhãn chứ không tô xanh lá. */
type FxPoint = FxRow & { nhan: string; vung: [number, number] };

function FxChart({ fx, kyDangXem: viewedFile, te: currency = TW_CURRENCY }: { fx: Fx; kyDangXem?: string; te?: Currency }) {
    const best = fx.best_vnd_per_twd;
    const data: FxPoint[] = [...fx.rows].reverse()
        .filter((r) => r.vnd_per_twd != null)
        .map((r) => ({
            ...r,
            nhan: r.period_date ? `${r.period_date.slice(8, 10)}/${r.period_date.slice(5, 7)}` : r.filename,
            vung: [r.vnd_per_twd!, best ?? r.vnd_per_twd!],
        }));
    if (best == null || data.length < 2) return null;

    const lowest = Math.min(...data.map((d) => d.vnd_per_twd!));
    const step = best - lowest > 8 ? 4 : 2;
    const axisMin = Math.floor((lowest - 1) / step) * step;
    const axisMax = Math.ceil((best + 1) / step) * step;
    const ticks = Array.from({ length: (axisMax - axisMin) / step + 1 }, (_, i) => axisMin + i * step);
    const last = data[data.length - 1];

    return (
        <div className="px-3 pb-2 pt-3 [--fx-line:#0284c7] [--fx-loss:#e11d48] dark:[--fx-loss:#f43f5e] sm:px-5">
            <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-[12px] text-muted-foreground sm:px-0">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full" style={{ background: "var(--fx-line)" }} />
                    Đồng thực nhận / {currency.ky}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-muted-foreground/70" />
                    Kỳ tốt nhất NAZA từng đặt
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-4 rounded-sm" style={{ background: "var(--fx-loss)", opacity: 0.22 }} />
                    Phần tỷ giá lấy của mình
                </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={data} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="nhan" tickLine={false} axisLine={false} interval="preserveStartEnd"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickMargin={8} />
                    <YAxis domain={[axisMin, axisMax]} ticks={ticks} width={40} tickLine={false} axisLine={false}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip content={<FxTooltip te={currency} />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4, strokeWidth: 1 }} />
                    <Area type="linear" dataKey="vung" stroke="none" fill="var(--fx-loss)" fillOpacity={0.14}
                        isAnimationActive={false} activeDot={false} />
                    <ReferenceLine y={best} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.8}
                        strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain"
                        label={{ value: `tốt nhất ${best.toFixed(2)}`, position: "insideBottomLeft", offset: 6,
                            fontSize: 11, fontWeight: 600, fill: "hsl(var(--muted-foreground))" }} />
                    <Line type="linear" dataKey="vnd_per_twd" stroke="var(--fx-line)" strokeWidth={2}
                        isAnimationActive={false}
                        activeDot={{ r: 6, fill: "var(--fx-line)", stroke: "hsl(var(--card))", strokeWidth: 2 }}
                        dot={(p: { cx?: number; cy?: number; index?: number; payload?: FxPoint }) => {
                            const { cx, cy, payload } = p;
                            if (cx == null || cy == null || !payload) return <g key={`d${p.index}`} />;
                            const selected = payload.filename === viewedFile;
                            return (
                                <g key={payload.filename}>
                                    {selected && <circle cx={cx} cy={cy} r={10} fill="var(--fx-line)" fillOpacity={0.15} />}
                                    <circle cx={cx} cy={cy} r={selected ? 5.5 : 4} fill="var(--fx-line)"
                                        stroke="hsl(var(--card))" strokeWidth={2} />
                                    {payload === last && (
                                        <text x={cx + 6} y={cy - 12} textAnchor="end" fontSize={11.5} fontWeight={700}
                                            fill="hsl(var(--foreground))">
                                            {payload.vnd_per_twd!.toFixed(2)}
                                        </text>
                                    )}
                                </g>
                            );
                        }} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

function FxTooltip({ active, payload, te: currency = TW_CURRENCY }: { active?: boolean; payload?: { payload: FxPoint }[]; te?: Currency }) {
    const d = active ? payload?.[0]?.payload : undefined;
    if (!d) return null;
    return (
        <div className="min-w-[210px] rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12.5px] shadow-lg">
            <div className="mb-1.5 font-semibold text-foreground">Kỳ chốt {dmy(d.period_date)}</div>
            <div className="flex items-baseline justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: "var(--fx-line)" }} />Đồng / {currency.ky}
                </span>
                <span className="font-bold tabular-nums text-foreground">{d.vnd_per_twd?.toFixed(2)}</span>
            </div>
            <div className="mt-0.5 text-right text-[11.5px] tabular-nums text-muted-foreground">
                {d.rate_twd_rmb} × {d.rate_rmb_vnd}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-border/70 pt-1.5">
                <span className="text-muted-foreground">Tiền COD</span>
                <span className="tabular-nums text-foreground">{currency.fmt(d.cod_twd)}</span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Thiệt so kỳ tốt nhất</span>
                {d.tot_nhat
                    ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">kỳ tốt nhất</span>
                    : <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">−{VND(d.thiet_vnd ?? 0)}</span>}
            </div>
        </div>
    );
}
