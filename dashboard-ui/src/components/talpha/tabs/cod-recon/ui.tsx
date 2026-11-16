"use client";

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { CalendarDays, Check, ChevronDown, Layers, X } from "lucide-react";
import { cn } from "../../utils";
import type { PeriodState } from "./types";

/* ═══════════════════════ mảnh dùng lại ═══════════════════════
   Màu chữ đi theo NGHĨA của con số, cả tab một luật — nhìn màu là biết loại tiền:
     xanh dương = NT$ (tiền Đài)      tím = ¥ (tiền Trung)      xanh lá = tiền về tay
     cam        = tiền hàng           đỏ  = khoản bị trừ / thiếu / nợ
     vàng hổ phách = số dự tính, số còn chờ
   Số tiền dùng chính font chữ với chữ số thẳng cột (tabular-nums) — font mono cũ
   làm bảng trông như màn hình dòng lệnh. Font mono chỉ còn cho mã vận đơn và số
   điện thoại, là thứ phải dò từng ký tự. */

/** Hàng đầu tab: chọn nước · nguồn số (chữ nhỏ) · nút bên phải. */
export function HeaderBar({ nutNuoc: marketSwitcher, nguon: source, phai: actions }: { nutNuoc?: ReactNode; nguon?: ReactNode; phai?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {marketSwitcher}
            {source && <span className="text-xs leading-relaxed text-muted-foreground">{source}</span>}
            {actions && <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">{actions}</div>}
        </div>
    );
}

/** Ô số tiền gọn (thay ba thẻ to + banner ngân hàng): nhãn · số · một dòng phụ. */
const TILE_COLORS = {
    xanh: "text-emerald-600 dark:text-emerald-400",
    vang: "text-amber-600 dark:text-amber-400",
    cam: "text-orange-600 dark:text-orange-400",
    xanhduong: "text-sky-700 dark:text-sky-300",
    do: "text-rose-600 dark:text-rose-400",
} as const;
export function MoneyTile({ mau: color, nhan: caption, so: figure, phu: subtitle, uoc: estimated, className }: {
    mau: keyof typeof TILE_COLORS; nhan: string; so: string; phu?: ReactNode; uoc?: boolean; className?: string;
}) {
    return (
        <div className={cn("min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm md:px-4 md:py-3", className)}>
            <div className="text-[11.5px] font-medium leading-snug text-muted-foreground">{caption}</div>
            <div className={cn("mt-1 whitespace-nowrap text-[19px] font-extrabold leading-tight tracking-tight tabular-nums md:text-[22px]", TILE_COLORS[color])}>
                {estimated && <span className="mr-0.5 text-[0.75em] font-bold opacity-60">≈</span>}{figure}
            </div>
            {subtitle && <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{subtitle}</div>}
        </div>
    );
}

/**
 * Một bước trong quy trình.
 *
 * `phamVi` là thứ sửa đúng lời chê nặng nhất của Sỹ Anh — "không biết số nào
 * của kỳ nào". Mỗi khối phải TỰ KHAI số của nó thuộc một kỳ hay cộng dồn, đóng
 * dấu ngay góc phải, không để người đọc tự đoán.
 */
export function Section({ so: figure, ten: title, phamVi: scope, phu: subtitle, dem: countLabel, phai: actions, gap: collapsible, children }: {
    so: string; ten: string; phamVi: "one" | "all";
    phu?: string; dem?: string; phai?: React.ReactNode;
    /** Khối gập được (07/10/2026): `mo` là trạng thái ban đầu; bấm tiêu đề để mở/gập. */
    gap?: { mo: boolean };
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(collapsible ? collapsible.mo : true);
    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <header
                onClick={collapsible ? () => setOpen(!open) : undefined}
                className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3.5 py-3 md:px-5",
                    open && "border-b border-border/70", collapsible && "cursor-pointer hover:bg-muted/30")}>
                {/* Số bước nhỏ, màu trầm — trước là ô gradient cam to, sáu khối sáu ô cam nên rối mắt. */}
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-muted text-[12px] font-bold text-muted-foreground">
                    {figure}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-bold leading-tight text-foreground">{title}</h3>
                        {countLabel && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[12px] font-bold tabular-nums text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                                {countLabel}
                            </span>
                        )}
                        {/* "Cộng dồn / chỉ kỳ này" — sửa lời chê "không biết số nào của kỳ nào"; giữ, nhưng nhỏ. */}
                        <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
                            scope === "one" ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300")}>
                            {scope === "one" ? <CalendarDays className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                            {scope === "one" ? "chỉ kỳ này" : "cộng dồn"}
                        </span>
                    </div>
                    {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{subtitle}</p>}
                </div>
                {actions && <div className="flex max-w-full flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>{actions}</div>}
                {collapsible && <ChevronDown className={cn("h-4 w-4 flex-none text-muted-foreground transition-transform", open && "rotate-180")} />}
            </header>
            {open && children}
        </section>
    );
}

export function ActionButton({ children, onClick, kieu: variant, busy, busyText, lon: large }: {
    children: React.ReactNode; onClick?: () => void;
    kieu?: "chinh" | "xong"; busy?: boolean; busyText?: string; lon?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={busy}
            className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                large ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[13px]",
                variant === "chinh" ? "bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-sm shadow-orange-600/25 hover:from-orange-600 hover:to-orange-700"
                    : variant === "xong" ? "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                        : "border border-border bg-card text-foreground/80 shadow-sm hover:bg-muted hover:text-foreground")}>
            {busy ? (busyText || "Đang ghi…") : children}
        </button>
    );
}

const KPI_TONE = {
    twd: "text-sky-700 dark:text-sky-300",
    rmb: "text-violet-700 dark:text-violet-300",
    hang: "text-orange-600 dark:text-orange-400",
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-rose-600 dark:text-rose-400",
    cho: "text-amber-600 dark:text-amber-400",
} as const;

export function Kpi({ label, value, sub, tone, className }: {
    label: string; value: string; sub?: string; tone?: keyof typeof KPI_TONE; className?: string;
}) {
    return (
        <div className={cn("bg-card px-5 py-3.5", className)}>
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-[20px] font-extrabold leading-tight tracking-tight tabular-nums text-foreground",
                tone && KPI_TONE[tone])}>{value}</div>
            {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{sub}</div>}
        </div>
    );
}

export function StatusBadge({ p }: { p: { trang_thai: PeriodState | "am"; trang_thai_chu: string } }) {
    const style: Record<PeriodState | "am", string> = {
        am: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/25",
        khop: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25",
        lech: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/25",
        cho_nhap: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/25",
        thieu_file: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/25",
    };
    return (
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset",
            style[p.trang_thai])}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {p.trang_thai_chu}
        </span>
    );
}

/**
 * Ô nhập tiền thật về — số và ngày, gọn trong một dòng của bảng.
 *
 * Gợi ý sẵn số sao kê tính ra làm placeholder, nhưng KHÔNG điền sẵn vào ô: điền
 * sẵn thì người ta chỉ việc bấm Enter, và cả khâu đối chiếu hoá ra vô nghĩa vì
 * số "thực nhận" chính là số "phải nhận" chép lại.
 */
export function FormBank({ goiY: suggested, busy, onGhi: onSave, onHuy: onCancel }: {
    goiY: number | null; busy: boolean;
    onGhi: (figure: number, date: string) => void; onHuy: () => void;
}) {
    const [figure, setFigure] = useState("");
    const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const num = Number(figure.replace(/\D/g, ""));
    const o = "h-8 rounded-lg border border-border bg-card text-[13px] shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:[color-scheme:dark]";
    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
            <input autoFocus inputMode="numeric" value={figure}
                placeholder={suggested != null ? Math.round(suggested).toLocaleString("vi-VN") : "số tiền"}
                onChange={(e) => setFigure(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && num > 0) onSave(num, date);
                    if (e.key === "Escape") onCancel();
                }}
                className={cn(o, "w-32 px-2.5 text-right font-semibold tabular-nums")} />
            <input type="date" value={date} max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => setDate(e.target.value)}
                className={cn(o, "px-2 tabular-nums")} />
            <button disabled={busy || !(num > 0)} onClick={() => onSave(num, date)} title="Ghi số tiền về"
                className="grid h-8 w-8 place-items-center rounded-lg bg-orange-500 text-white shadow-sm hover:bg-orange-600 disabled:opacity-40">
                <Check className="h-4 w-4" />
            </button>
            <button onClick={onCancel} title="Huỷ"
                className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
