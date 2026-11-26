"use client";

// AI Chatbot — thành phần dùng chung cho 5 tab (Tổng quan · Kiến thức · AI Learning · Nhật ký · Cài đặt).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DECISION_LABELS, reasonLabel } from "@/lib/ai-chatbot/reasons";

export { reasonLabel };

/** Gọi API JSON: lỗi HTTP → Error(câu tiếng Việt của máy chủ). */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
    const { json, ...rest } = init || {};
    const r = await fetch(url, {
        cache: "no-store", ...rest,
        ...(json !== undefined ? { method: rest.method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) } : {}),
    });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j as T;
}

/** Tải dữ liệu theo `url` (null = chưa tải). Trả data, lỗi, đang tải, tải lại. */
export function useApi<T = any>(url: string | null) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const seq = useRef(0);
    const reload = useCallback(async () => {
        if (!url) return;
        const my = ++seq.current;
        setLoading(true);
        try {
            const d = await api<T>(url);
            if (my === seq.current) { setData(d); setError(""); }
        } catch (e) {
            if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
        } finally {
            if (my === seq.current) setLoading(false);
        }
    }, [url]);
    useEffect(() => { reload(); }, [reload]);
    return { data, error, loading, reload, setData };
}

export function ErrorBox({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <div>{children}</div>
        </div>
    );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
    const cls = {
        info: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
        warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
        ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    }[tone];
    return <div className={cn("rounded-xl border p-3 text-sm", cls)}>{children}</div>;
}

export function Loading({ label = "Đang tải…" }: { label?: string }) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-orange-500" /> {label}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            <Inbox className="h-6 w-6" /> {children}
        </div>
    );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn("rounded-xl border border-border bg-card p-3 md:p-4", className)}>
            {(title || actions) && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
                    {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
                </div>
            )}
            {children}
        </section>
    );
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / size));
    if (total <= size) return <p className="mt-2 text-xs text-muted-foreground">{total.toLocaleString("vi-VN")} dòng</p>;
    return (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{total.toLocaleString("vi-VN")} dòng · trang {page}/{pages}</span>
            <div className="flex items-center gap-1">
                <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border border-border p-1.5 hover:bg-muted disabled:opacity-40" aria-label="Trang trước"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-lg border border-border p-1.5 hover:bg-muted disabled:opacity-40" aria-label="Trang sau"><ChevronRight className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

const DECISION_STYLE: Record<string, string> = {
    answered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    shadow: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    escalated: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    skipped: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
    error: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function DecisionBadge({ decision }: { decision: string }) {
    return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", DECISION_STYLE[decision] || DECISION_STYLE.skipped)}>{DECISION_LABELS[decision] || decision}</span>;
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
    const t = {
        slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
        green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
        red: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        blue: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    }[tone];
    return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", t)}>{children}</span>;
}

export const fmtUsd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${Number(n).toFixed(Number(n) < 1 ? 4 : 2)}`);
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("vi-VN"));
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 1000) / 10}%`);
export function fmtTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20";
export const btnCls = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50";
export const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50";

/** Nút chạy việc bất đồng bộ — tự quay vòng khi đang chạy, báo lỗi / kết quả qua onDone. */
export function ActionButton({ onClick, children, primary, disabled, title }: {
    onClick: () => Promise<unknown>; children: ReactNode; primary?: boolean; disabled?: boolean; title?: string;
}) {
    const [busy, setBusy] = useState(false);
    return (
        <button type="button" title={title} disabled={busy || disabled} className={primary ? btnPrimary : btnCls}
            onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {children}
        </button>
    );
}

/** Dòng thông báo kết quả thao tác (tự ẩn sau 8 giây). */
export function useFlash() {
    const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
    useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 8000); return () => clearTimeout(t); }, [msg]);
    const node = msg ? (
        <div className={cn("rounded-lg px-3 py-2 text-sm", msg.tone === "ok"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300")}>{msg.text}</div>
    ) : null;
    return {
        node,
        ok: (text: string) => setMsg({ tone: "ok", text }),
        err: (e: unknown) => setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) }),
    };
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "green" | "amber" | "blue" }) {
    const color = tone === "green" ? "text-emerald-600 dark:text-emerald-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : tone === "blue" ? "text-sky-600 dark:text-sky-400" : "text-foreground";
    return (
        <div className="rounded-xl border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-xl font-semibold tabular-nums", color)}>{value}</div>
            {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
        </div>
    );
}

/** Ngày "YYYY-MM-DD" theo giờ máy (bộ chọn ngày của shell trả Date giờ địa phương). */
export function ymd(d?: Date): string | undefined {
    if (!d) return undefined;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
