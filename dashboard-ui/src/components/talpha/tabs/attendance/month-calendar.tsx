"use client";

import { cn } from "@/lib/utils";
import { STATUS, WEEKDAY_SHORT, fmtDuration, fmtShort, type DaySummary, type MonthTotals } from "./types";

// Lịch tháng: mỗi ô một ngày — giờ vào → giờ ra, màu theo trạng thái (đúng giờ, muộn, thiếu chấm, vắng…). Bấm ô để xem
// chi tiết từng lần chấm (IP, vị trí) ở khung bên dưới.
export default function MonthCalendar({ days, today, selected, onSelect }: {
    days: DaySummary[]; today: string; selected: string | null; onSelect: (date: string) => void;
}) {
    if (!days.length) return null;
    const lead = days[0].weekday - 1;   // lịch bắt đầu thứ Hai
    return (
        <div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground md:gap-1.5">
                {WEEKDAY_SHORT.slice(1).map((w) => <div key={w} className="py-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 md:gap-1.5">
                {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
                {days.map((d) => {
                    const st = STATUS[d.status];
                    const isToday = d.date === today;
                    return (
                        <button
                            key={d.date}
                            type="button"
                            onClick={() => onSelect(d.date)}
                            className={cn(
                                "flex min-h-[64px] flex-col items-stretch rounded-lg border p-1 text-left transition-shadow hover:shadow-md md:min-h-[84px] md:p-1.5",
                                st.cell,
                                selected === d.date && "ring-2 ring-indigo-500",
                                isToday && selected !== d.date && "ring-2 ring-orange-400",
                                d.status === "future" && "opacity-60",
                            )}
                        >
                            <span className={cn("text-xs font-semibold", isToday ? "text-orange-600 dark:text-orange-400" : "text-foreground")}>
                                {Number(d.date.slice(8))}
                            </span>
                            {(d.in_hhmm || d.out_hhmm) && (
                                <span className="mt-auto text-[10px] leading-tight tabular-nums text-foreground md:text-xs">
                                    <span className="block">{d.in_hhmm || "--:--"}</span>
                                    <span className="block text-muted-foreground">{d.out_hhmm || "--:--"}</span>
                                </span>
                            )}
                            {(st.label || d.worked_minutes) && (
                                <span className="mt-0.5 hidden truncate text-[10px] text-muted-foreground md:block">
                                    {[st.label, fmtShort(d.worked_minutes), d.sessions.length > 1 ? `${d.sessions.length} ca` : ""].filter(Boolean).join(" · ")}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function MonthTotalsBar({ totals, scheduleEnabled }: { totals: MonthTotals; scheduleEnabled: boolean }) {
    // Không tính giờ làm (talpha_rules.json → attendance.schedule_enabled = false): chỉ đếm ngày có chấm, thiếu chấm, giờ làm.
    const doneDays = totals.present - totals.missing;
    const items: { label: string; value: string; tone?: string }[] = !scheduleEnabled ? [
        { label: "Ngày có chấm", value: String(totals.present) },
        { label: "Thiếu chấm", value: String(totals.missing), tone: totals.missing ? "text-rose-600 dark:text-rose-400" : undefined },
        { label: "Tổng giờ làm", value: fmtDuration(totals.worked_minutes) },
        { label: "TB mỗi ngày", value: doneDays > 0 && totals.worked_minutes ? fmtDuration(Math.round(totals.worked_minutes / doneDays)) : "—" },
    ] : [
        { label: "Ngày công", value: `${totals.present}/${totals.workdays}` },
        { label: "Đúng giờ", value: String(totals.on_time), tone: "text-emerald-600 dark:text-emerald-400" },
        { label: "Đi muộn", value: totals.late ? `${totals.late} lần · ${totals.late_minutes}′` : "0", tone: totals.late ? "text-amber-600 dark:text-amber-400" : undefined },
        { label: "Về sớm", value: String(totals.early), tone: totals.early ? "text-amber-600 dark:text-amber-400" : undefined },
        { label: "Thiếu chấm", value: String(totals.missing), tone: totals.missing ? "text-rose-600 dark:text-rose-400" : undefined },
        { label: "Vắng", value: String(totals.absent), tone: totals.absent ? "text-rose-600 dark:text-rose-400" : undefined },
        { label: "Giờ làm", value: fmtDuration(totals.worked_minutes) },
    ];
    if (totals.off_worked) items.push({ label: "Làm ngày nghỉ", value: String(totals.off_worked), tone: "text-violet-600 dark:text-violet-400" });
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {items.map((it) => (
                <div key={it.label} className="rounded-lg border border-border bg-card px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">{it.label}</p>
                    <p className={cn("text-base font-semibold tabular-nums text-foreground", it.tone)}>{it.value}</p>
                </div>
            ))}
        </div>
    );
}
