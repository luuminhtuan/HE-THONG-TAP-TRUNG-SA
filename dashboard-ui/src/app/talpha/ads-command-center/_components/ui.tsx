import { cn } from "@/components/talpha/utils";
import { ROAS_GOOD } from "./constants";

// ── small UI helpers (style only — no business logic) ──
export type Accent = "slate" | "purple" | "blue" | "emerald" | "amber" | "indigo" | "cyan" | "rose";
export const ACCENT: Record<Accent, { ring: string; text: string; chip: string; glow: string; bar: string }> = {
    slate:   { ring: "border-slate-600/60",  text: "text-slate-100",   chip: "bg-slate-500/15 text-slate-300",   glow: "from-slate-500/10",   bar: "bg-slate-400" },
    purple:  { ring: "border-purple-500/40", text: "text-purple-300",  chip: "bg-purple-500/15 text-purple-300", glow: "from-purple-500/15",  bar: "bg-purple-400" },
    blue:    { ring: "border-blue-500/40",   text: "text-blue-300",    chip: "bg-blue-500/15 text-blue-300",     glow: "from-blue-500/15",    bar: "bg-blue-400" },
    emerald: { ring: "border-emerald-500/40",text: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300",glow: "from-emerald-500/15", bar: "bg-emerald-400" },
    amber:   { ring: "border-amber-500/40",  text: "text-amber-300",   chip: "bg-amber-500/15 text-amber-300",   glow: "from-amber-500/15",   bar: "bg-amber-400" },
    indigo:  { ring: "border-indigo-500/40", text: "text-indigo-300",  chip: "bg-indigo-500/15 text-indigo-300", glow: "from-indigo-500/15",  bar: "bg-indigo-400" },
    cyan:    { ring: "border-cyan-500/40",   text: "text-cyan-300",    chip: "bg-cyan-500/15 text-cyan-300",     glow: "from-cyan-500/15",    bar: "bg-cyan-400" },
    rose:    { ring: "border-rose-500/40",   text: "text-rose-300",    chip: "bg-rose-500/15 text-rose-300",     glow: "from-rose-500/15",    bar: "bg-rose-400" },
};

export function KpiCard({ icon: Icon, label, value, sub, accent, valueClass }: {
    icon: any; label: string; value: string; sub?: React.ReactNode; accent: Accent; valueClass?: string;
}) {
    const a = ACCENT[accent];
    return (
        <div className={cn(
            "relative overflow-hidden rounded-2xl border bg-[#1B1A17]/80 p-3.5 transition-all duration-200",
            "hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40", a.ring
        )}>
            <div className={cn("pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-gradient-to-b to-transparent blur-2xl", a.glow)} />
            <div className="relative flex items-start justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
                <span className={cn("grid h-7 w-7 place-items-center rounded-lg", a.chip)}><Icon className="h-3.5 w-3.5" /></span>
            </div>
            <div className={cn("relative mt-1.5 font-mono text-2xl font-extrabold tabular-nums", valueClass || a.text)}>{value}</div>
            {sub && <div className="relative mt-0.5 text-[10px] text-slate-500">{sub}</div>}
        </div>
    );
}

export function roasTone(roas: number) {
    if (roas >= ROAS_GOOD) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    if (roas > 1) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    if (roas > 0) return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    return "bg-slate-700/40 text-slate-500 border-slate-700";
}

export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
    return <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold", className)}>{children}</span>;
}
