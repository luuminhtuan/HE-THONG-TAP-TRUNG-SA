"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, Info, SearchCheck } from "lucide-react";
import { cn } from "../../utils";
// Kiểu `Check` trùng tên biểu tượng lucide `Check` dùng trong file này — đặt tên khác khi nhập.
import type { Check as ReconCheck } from "./types";

/** Tám mục máy soát — gập lại thành một dòng tóm tắt; có mục lỗi thì mở sẵn (07/10/2026). */
export function ChecksPanel({ checks, kyKhac: isOlderPeriod, children }: { checks: ReconCheck[]; kyKhac: boolean; children: ReactNode }) {
    const failedCount = checks.filter((c) => c.ok === false).length;
    const passedCount = checks.filter((c) => c.ok === true).length;
    const [open, setOpen] = useState(failedCount > 0);
    if (!checks.length) return null;
    return (
        <>
            <button onClick={() => setOpen(!open)} aria-expanded={open}
                className="flex w-full items-center gap-2 border-t border-border/70 px-3.5 py-2.5 text-left text-[13px] hover:bg-muted/30 md:px-5">
                <SearchCheck className="h-4 w-4 flex-none text-muted-foreground" />
                <span className="font-semibold text-foreground">Máy soát {checks.length} mục{isOlderPeriod ? " · kỳ mới nhất" : ""}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                    failedCount ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {passedCount} đạt{failedCount ? ` · ${failedCount} cần xử` : ""}
                </span>
                {checks.length - passedCount - failedCount > 0 && (
                    <span className="text-[11.5px] text-muted-foreground">{checks.length - passedCount - failedCount} chưa soát được</span>
                )}
                <ChevronDown className={cn("ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>
            {open && children}
        </>
    );
}

export function CheckGroup({ nhom: group, ten: title, hoi: question, checks }: { nhom: "A" | "B"; ten: string; hoi: string; checks: ReconCheck[] }) {
    if (!checks.length) return null;
    const failedCount = checks.filter((c) => c.ok === false).length;
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-4 py-2.5">
                <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-foreground/[0.07] text-[12px] font-extrabold text-foreground/75">
                    {group}
                </span>
                <span className="text-[13.5px] font-bold text-foreground">{title}</span>
                <span className="text-[12.5px] text-muted-foreground">— {question}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                    failedCount ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300")}>
                    {failedCount ? `${failedCount} mục cần xử` : "sạch"}
                </span>
            </div>
            <ul className="divide-y divide-border/60">
                {checks.map((c) => (
                    <li key={c.ten} className={cn("flex items-start gap-3 px-4 py-2.5",
                        c.ok === false && "bg-rose-50/60 dark:bg-rose-500/[0.06]")}>
                        <span className={cn("mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full",
                            c.ok === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : c.ok === false ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                                    : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300")}>
                            {c.ok === true ? <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                : c.ok === false ? <AlertTriangle className="h-3.5 w-3.5" />
                                    : <Info className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0">
                            <div className={cn("text-[13.5px] font-semibold",
                                c.ok === false ? "text-rose-700 dark:text-rose-300" : "text-foreground")}>{c.ten}</div>
                            <div className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{c.chi_tiet}</div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
