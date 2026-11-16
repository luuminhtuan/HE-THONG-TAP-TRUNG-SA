"use client";

// ═══════════════════════════════════════════════════════════════════
// Khách hàng → Tệp khách (14/11/2026). Số THAM CHIẾU về người Việt / Phi / Indo ở từng thị
// trường: thống kê nhà nước + quy mô đối tượng Facebook (nam nữ, độ tuổi). Không phải số bán
// hàng và không theo bộ chọn ngày — mỗi lần đo là một bản trong config/customer_segments.json.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ExternalLink } from "lucide-react";
import TabSkeleton from "@/components/ui/tab-skeleton";
import { cn } from "@/lib/utils";
import {
    midpoint, femaleShare, ageShares, AGE_BANDS,
    type SegmentTable, type Range, type SegmentCode, type SegmentSnapshot, type CustomerSegmentsFile,
    type MarketSegments, type Trend,
} from "@/lib/talpha/customer-segments";

const SEGMENTS: SegmentCode[] = ["VN", "PH", "ID"];

// Màu đi theo NHÓM (Việt · Phi · Indo), giữ nguyên ở mọi biểu đồ của tab.
const COLORS: Record<SegmentCode, { hex: string; solid: string; light: string; border: string }> = {
    VN: { hex: "#2a78d6", solid: "bg-[#2a78d6] dark:bg-[#3987e5]", light: "bg-[#2a78d6]/35 dark:bg-[#3987e5]/40", border: "border-t-[#2a78d6] dark:border-t-[#3987e5]" },
    PH: { hex: "#eb6834", solid: "bg-[#eb6834] dark:bg-[#d95926]", light: "bg-[#eb6834]/35 dark:bg-[#d95926]/40", border: "border-t-[#eb6834] dark:border-t-[#d95926]" },
    ID: { hex: "#1baf7a", solid: "bg-[#1baf7a] dark:bg-[#199e70]", light: "bg-[#1baf7a]/35 dark:bg-[#199e70]/40", border: "border-t-[#1baf7a] dark:border-t-[#199e70]" },
};

type Payload = CustomerSegmentsFile & { seen_all?: boolean };
type Groups = CustomerSegmentsFile["groups"];

const fmtNum = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n));
const thousands = (k: Range) => `${Math.round(k[0] / 1000)}–${Math.round(k[1] / 1000)} nghìn`;
const millions = (k: Range, digits = 2) => `${(k[0] / 1e6).toFixed(digits).replace(".", ",")}–${(k[1] / 1e6).toFixed(digits).replace(".", ",")} triệu`;
const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits).replace(".", ",")}%`;
const vnDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; };

/** "Cuối 2015" → 2016 · "9/2026" → 2026,75: để trục thời gian chia đúng tỷ lệ, không dồn đều. */
function periodToYear(period: string): number {
    const yearEnd = /(\d{4})\s*$/.exec(period);
    const monthYear = /^(\d{1,2})\/(\d{4})$/.exec(period.trim());
    if (monthYear) return Number(monthYear[2]) + Number(monthYear[1]) / 12;
    return yearEnd ? Number(yearEnd[1]) + 1 : 0;
}

const CARD = "rounded-xl border border-border bg-card p-4 shadow-sm";
const TITLE = "text-sm font-semibold text-foreground";

export default function CustomerSegmentsTab() {
    const [data, setData] = useState<Payload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/talpha/customer-segments")
            .then(async (r) => {
                const d = await r.json();
                if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
                return d as Payload;
            })
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) setError(String(e?.message || e)); });
        return () => { cancelled = true; };
    }, []);

    if (error) {
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                Không đọc được số tệp khách: {error}
            </div>
        );
    }
    if (!data) return <TabSkeleton cards={3} rows={6} />;

    const snap: SegmentSnapshot | undefined = data.snapshots[selected] ?? data.snapshots[0];
    if (!snap) {
        return <div className={cn(CARD, "text-sm text-muted-foreground")}>Chưa có bản đo tệp khách nào cho thị trường của team này.</div>;
    }
    const markets = Object.entries(snap.markets);
    const seesAll = data.seen_all !== false;

    return (
        <div className="space-y-6">
            {/* ── Đầu trang: bản đo nào, đo bằng cách gì ── */}
            <div className={cn(CARD, "space-y-2")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="text-base font-semibold text-foreground">Tệp người Việt · Phi · Indo theo thị trường</h2>
                        <p className="text-xs text-muted-foreground">Đo ngày {vnDate(snap.measured_on)} · số tham chiếu, không theo bộ chọn ngày</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {data.snapshots.length > 1 && (
                            <select
                                id="customer-segments-snapshot"
                                value={selected}
                                onChange={(e) => setSelected(Number(e.target.value))}
                                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                                aria-label="Chọn bản đo"
                            >
                                {data.snapshots.map((s, i) => <option key={s.measured_on} value={i}>Bản đo {vnDate(s.measured_on)}</option>)}
                            </select>
                        )}
                        {snap.report_url && (
                            <a href={snap.report_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted">
                                Báo cáo đầy đủ <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        )}
                    </div>
                </div>
                <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">{snap.method}</p>
                {!seesAll && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">Đang chỉ hiện thị trường của team bạn. Giám đốc xem được đủ mọi thị trường.</p>
                )}
            </div>

            {seesAll && snap.summary.length > 0 && (
                <div className={CARD}>
                    <h3 className={cn(TITLE, "mb-2")}>Đọc nhanh</h3>
                    <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-sm text-foreground">
                        {snap.summary.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                </div>
            )}

            <SegmentSizes markets={markets} groups={data.groups} />

            {/* ── Chân dung từng tệp ── */}
            {markets.map(([code, m]) => (
                <section key={code} className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="text-base font-semibold text-foreground">{m.name}</h3>
                        <span className="text-xs text-muted-foreground">Facebook cả nước {millions(m.fb_country, 1)} tài khoản · {m.official_source}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        {SEGMENTS.map((n) => m.segments[n] && <SegmentCard key={n} code={n} title={`${data.groups[n].full_name} ở ${m.name}`} t={m.segments[n]} />)}
                    </div>
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {m.trend && <TrendChart x={m.trend} groups={data.groups} />}
                        {m.tables.map((b) => <SegmentTableCard key={b.title} b={b} groups={data.groups} />)}
                        {m.notes.length > 0 && (
                            <div className={CARD}>
                                <h4 className={cn(TITLE, "mb-2")}>Ghi chú {m.name}</h4>
                                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                                    {m.notes.map((g, i) => <li key={i}>{g}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                </section>
            ))}

            {seesAll && snap.recommendation.ranking.length > 0 && (
                <div className={CARD}>
                    <h3 className={TITLE}>Nên đánh tệp nào trước</h3>
                    <p className="mb-3 mt-1 max-w-4xl text-xs text-muted-foreground">{snap.recommendation.note}</p>
                    <ol className="max-w-4xl list-decimal space-y-2 pl-5 text-sm text-foreground">
                        {snap.recommendation.ranking.map((x) => (
                            <li key={x.segment}><strong className="font-semibold">{x.segment}.</strong> <span className="text-muted-foreground">{x.reason}</span></li>
                        ))}
                    </ol>
                </div>
            )}

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className={CARD}>
                    <h3 className={cn(TITLE, "mb-2")}>Cài tệp trong Ads Manager</h3>
                    <p className="mb-2 text-sm text-muted-foreground">
                        Bấm &quot;Chuyển sang lựa chọn đối tượng ban đầu&quot;, chọn Vị trí là quốc gia, rồi ở Nhắm mục tiêu chi tiết chọn Hành vi → Ngoại kiều:
                    </p>
                    <ul className="space-y-1.5 text-sm">
                        {SEGMENTS.map((n) => (
                            <li key={n} className="flex flex-wrap items-baseline gap-x-2">
                                <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", COLORS[n].solid)} aria-hidden />
                                <span className="text-foreground">{data.groups[n].meta_behavior}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">toàn cầu {millions(data.groups[n].fb_global, 1)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className={CARD}>
                    <h3 className={cn(TITLE, "mb-2")}>Giới hạn của số liệu</h3>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                        {snap.limitations.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                </div>
            </div>

            <details className={CARD}>
                <summary className="cursor-pointer text-sm font-semibold text-foreground">Nguồn ({snap.sources.length})</summary>
                <ul className="mt-3 space-y-1 text-sm">
                    {snap.sources.map((s) => (
                        <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">{s.name}</a></li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

/** Thanh ngang: đậm = mức thấp của Facebook, nhạt = tới mức cao; vạch đứng = số chính thức. */
function SegmentSizes({ markets, groups }: { markets: [string, MarketSegments][]; groups: Groups }) {
    const max = useMemo(() => {
        let m = 1;
        for (const [, t] of markets) for (const n of SEGMENTS) if (t.segments[n]) m = Math.max(m, t.segments[n].fb[1], t.segments[n].official);
        return m * 1.05;
    }, [markets]);
    return (
        <div className={CARD}>
            <h3 className={TITLE}>Quy mô từng tệp</h3>
            <div className="mb-3 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {SEGMENTS.map((n) => (
                    <span key={n} className="inline-flex items-center gap-1.5"><i className={cn("h-2.5 w-2.5 rounded-sm", COLORS[n].solid)} aria-hidden />{groups[n].name}</span>
                ))}
                <span>Thanh đậm → nhạt: Facebook mức thấp → mức cao</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-0.5 bg-foreground" aria-hidden />Số chính thức / ước tính</span>
            </div>
            <div className="divide-y divide-border">
                {markets.map(([code, m]) => {
                    const lo = SEGMENTS.reduce((s, n) => s + (m.segments[n]?.fb[0] || 0), 0);
                    const hi = SEGMENTS.reduce((s, n) => s + (m.segments[n]?.fb[1] || 0), 0);
                    return (
                        <div key={code} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span className="text-sm font-semibold text-foreground">{m.name}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    Ba tệp {millions([lo, hi])} · {pct((lo + hi) / 2 / midpoint(m.fb_country), 1)} Facebook cả nước
                                </span>
                            </div>
                            {SEGMENTS.map((n) => {
                                const t = m.segments[n];
                                if (!t) return null;
                                return (
                                    <div key={n} className="grid grid-cols-[40px_minmax(0,1fr)_104px] items-center gap-2 rounded-md hover:bg-muted/50"
                                        title={`${groups[n].full_name} ở ${m.name}\nFacebook: ${fmtNum(t.fb[0])} – ${fmtNum(t.fb[1])}\nNam ${thousands(t.male)} · Nữ ${thousands(t.female)}\n${t.official_note}`}>
                                        <span className="pl-1 text-xs font-medium text-muted-foreground">{groups[n].name}</span>
                                        <div className="relative h-5">
                                            <i className={cn("absolute left-0 top-1 h-3.5 rounded-r", COLORS[n].light)} style={{ width: `${(t.fb[1] / max) * 100}%` }} />
                                            <i className={cn("absolute left-0 top-1 h-3.5 rounded-r", COLORS[n].solid)} style={{ width: `${(t.fb[0] / max) * 100}%` }} />
                                            <i className="absolute top-0 h-5 w-0.5 bg-foreground ring-1 ring-card" style={{ left: `${(t.official / max) * 100}%` }} />
                                        </div>
                                        <span className="pr-1 text-right text-xs tabular-nums text-foreground">{thousands(t.fb)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function SegmentCard({ code, title, t }: { code: SegmentCode; title: string; t: MarketSegments["segments"][SegmentCode] }) {
    const female = femaleShare(t);
    const ages = ageShares(t);
    const maxAge = Math.max(...ages, 0.0001);
    return (
        <article className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-t-[3px] border-border bg-card p-4 shadow-sm", COLORS[code].border)}>
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <div>
                <div className="text-2xl font-bold leading-tight tabular-nums text-foreground">
                    {Math.round(t.fb[0] / 1000)}–{Math.round(t.fb[1] / 1000)} <span className="text-xs font-medium text-muted-foreground">nghìn tài khoản Facebook</span>
                </div>
                <div className="text-xs text-muted-foreground" title={t.official_note}>
                    {t.official_kind === "statistic" ? "Chính thức" : "Ước tính"} {fmtNum(t.official)} · {t.official_note}
                </div>
            </div>
            <div className="space-y-1">
                <div className="flex h-2.5 gap-0.5">
                    <i className={cn("rounded-l", COLORS[code].solid)} style={{ width: `${female * 100}%` }} />
                    <i className="flex-1 rounded-r bg-muted-foreground/30" />
                </div>
                <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                    <span>Nữ {pct(female)} · {thousands(t.female)}</span>
                    <span>Nam {pct(1 - female)}</span>
                </div>
            </div>
            <div className="grid h-24 grid-cols-4 items-end gap-2">
                {AGE_BANDS.map((k, i) => (
                    <div key={k} className="flex h-full flex-col items-center justify-end gap-0.5"
                        title={`${k} tuổi: ${t.ages[k] ? thousands(t.ages[k]) : "—"} · ${pct(ages[i], 1)} của tệp`}>
                        <b className="text-[11px] font-semibold tabular-nums text-foreground">{pct(ages[i])}</b>
                        <i className={cn("w-full max-w-[44px] rounded-t", COLORS[code].solid)} style={{ height: `${Math.max(2, (ages[i] / maxAge) * 56)}px` }} />
                        <span className="text-[10px] text-muted-foreground">{k}</span>
                    </div>
                ))}
            </div>
            <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {t.highlights.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
        </article>
    );
}

function TrendChart({ x, groups }: { x: Trend; groups: Groups }) {
    const rows = x.periods.map((period, i) => ({ period, t: periodToYear(period), VN: x.VN[i], PH: x.PH[i], ID: x.ID[i] }));
    const labels = new Map(rows.map((r) => [r.t, r.period]));
    // Nhãn trục: bỏ bớt cho khỏi chồng chữ, luôn giữ mốc đầu và mốc cuối.
    const step = Math.ceil(rows.length / 5);
    const ticks = rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => r.t);
    return (
        <div className={CARD}>
            <h4 className={TITLE}>{x.title}: {x.periods[0].replace("Cuối ", "")} → {x.periods[x.periods.length - 1]}</h4>
            <div className="mb-2 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {SEGMENTS.map((n) => (
                    <span key={n} className="inline-flex items-center gap-1.5">
                        <i className={cn("h-2.5 w-2.5 rounded-sm", COLORS[n].solid)} aria-hidden />{groups[n].name} <span className="tabular-nums text-foreground">{fmtNum(x[n][x[n].length - 1])}</span>
                    </span>
                ))}
            </div>
            <ResponsiveContainer width="100%" height={230}>
                <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#B1AEA0" strokeOpacity={0.25} vertical={false} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} ticks={ticks}
                        tick={{ fill: "#958F83", fontSize: 11 }} tickFormatter={(v: number) => (labels.get(v) || "").replace("Cuối ", "")} />
                    <YAxis tick={{ fill: "#958F83", fontSize: 11 }} width={44} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))", borderRadius: 8 }}
                        labelFormatter={(v: number) => labels.get(v) || ""}
                        formatter={(v: number, k: string) => [fmtNum(v), groups[k as SegmentCode]?.name || k]} />
                    {SEGMENTS.map((n) => <Line key={n} type="linear" dataKey={n} stroke={COLORS[n].hex} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} isAnimationActive={false} />)}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

function SegmentTableCard({ b, groups }: { b: SegmentTable; groups: Groups }) {
    const regular = b.rows.filter((d) => !d.total);
    const total = b.rows.find((d) => d.total);
    const max = Object.fromEntries(SEGMENTS.map((n) => [n, Math.max(...regular.map((d) => d[n]), 1)])) as Record<SegmentCode, number>;
    return (
        <div className={cn(CARD, "min-w-0")}>
            <h4 className={TITLE}>{b.title}</h4>
            <p className="mb-2 text-xs text-muted-foreground">{b.source}</p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-xs text-muted-foreground">
                            <th className="py-2 pl-1 text-left font-medium"> </th>
                            {SEGMENTS.map((n) => <th key={n} className="py-2 pr-2 text-right font-medium">{groups[n].name}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {b.rows.map((d) => (
                            <tr key={d.name} className={cn("border-b border-border/60 last:border-0", d.total && "font-semibold")}>
                                <td className="py-1.5 pl-1 text-foreground">{d.name}</td>
                                {SEGMENTS.map((n) => {
                                    const w = d.total ? 0 : (d[n] / max[n]) * 100;
                                    return (
                                        <td key={n} className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-foreground"
                                            style={d.total ? undefined : { background: `linear-gradient(to right, ${COLORS[n].hex}33 ${w}%, transparent ${w}%)` }}>
                                            {fmtNum(d[n])}
                                            {b.share_of_total && total && !d.total && <span className="ml-1 text-xs text-muted-foreground">{pct(d[n] / total[n])}</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
