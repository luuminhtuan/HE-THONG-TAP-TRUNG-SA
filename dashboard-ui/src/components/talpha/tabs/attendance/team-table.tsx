"use client";

import { cn } from "@/lib/utils";
import { STATUS, fmtDuration, type AttendanceData } from "./types";

// Bảng tổng cả công ty (chỉ giám đốc): hôm nay ai đã vào / ra, và số công cả tháng đang xem. Bấm một dòng để mở lịch
// của người đó.
export default function TeamTable({ team, today, month, selectedId, onSelect, scheduleEnabled }: {
    team: NonNullable<AttendanceData["team"]>; today: string; month: string; selectedId: string | null; onSelect: (id: string) => void;
    /** Tắt (talpha_rules.json → attendance.schedule_enabled) thì bỏ cột đúng giờ / muộn / sớm / vắng. */
    scheduleEnabled: boolean;
}) {
    const isCurrentMonth = today.slice(0, 7) === month;
    const inToday = team.filter((u) => u.today.first_in).length;
    const sched = scheduleEnabled;
    return (
        <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                <h3 className="text-base font-semibold text-foreground">Cả công ty — tháng {month.slice(5)}/{month.slice(0, 4)}</h3>
                <p className="text-xs text-muted-foreground">Hôm nay đã chấm vào: <strong className="text-foreground">{inToday}/{team.length}</strong> người</p>
            </div>
            <div className="overflow-x-auto">
                <table className={cn("w-full text-sm", sched ? "min-w-[760px]" : "min-w-[560px]")}>
                    <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="px-4 py-2 font-medium">Người</th>
                            <th className="px-2 py-2 font-medium">Hôm nay</th>
                            <th className="px-2 py-2 text-right font-medium">{sched ? `Công${isCurrentMonth ? " (tới nay)" : ""}` : "Ngày có chấm"}</th>
                            {sched && <>
                                <th className="px-2 py-2 text-right font-medium">Đúng giờ</th>
                                <th className="px-2 py-2 text-right font-medium">Đi muộn</th>
                                <th className="px-2 py-2 text-right font-medium">Về sớm</th>
                            </>}
                            <th className="px-2 py-2 text-right font-medium">Thiếu chấm</th>
                            {sched && <th className="px-2 py-2 text-right font-medium">Vắng</th>}
                            <th className="px-4 py-2 text-right font-medium">Giờ làm</th>
                        </tr>
                    </thead>
                    <tbody>
                        {team.map((u) => {
                            const st = STATUS[u.today.status];
                            const t = u.totals;
                            return (
                                <tr key={u.id} onClick={() => onSelect(u.id)}
                                    className={cn("cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/50", selectedId === u.id && "bg-indigo-50 dark:bg-indigo-500/10")}>
                                    <td className="px-4 py-2 font-medium text-foreground">{u.name}</td>
                                    <td className="px-2 py-2">
                                        <span className="tabular-nums text-foreground">{u.today.in_hhmm || "--:--"} → {u.today.out_hhmm || "--:--"}</span>
                                        {st.label && <span className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", st.badge)}>{st.label}</span>}
                                    </td>
                                    <td className="px-2 py-2 text-right tabular-nums">
                                        {sched ? (t.workdays ? `${t.present}/${t.workdays}` : "—") : (t.present || "—")}
                                    </td>
                                    {sched && <>
                                        <td className="px-2 py-2 text-right tabular-nums">{t.on_time || "—"}</td>
                                        <td className={cn("px-2 py-2 text-right tabular-nums", t.late && "text-amber-600 dark:text-amber-400")}>
                                            {t.late ? `${t.late} · ${t.late_minutes}′` : "—"}
                                        </td>
                                        <td className={cn("px-2 py-2 text-right tabular-nums", t.early && "text-amber-600 dark:text-amber-400")}>{t.early || "—"}</td>
                                    </>}
                                    <td className={cn("px-2 py-2 text-right tabular-nums", t.missing && "text-rose-600 dark:text-rose-400")}>{t.missing || "—"}</td>
                                    {sched && <td className={cn("px-2 py-2 text-right tabular-nums", t.absent && "text-rose-600 dark:text-rose-400")}>{t.absent || "—"}</td>}
                                    <td className="px-4 py-2 text-right tabular-nums">{fmtDuration(t.worked_minutes)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {sched && (
                <p className="px-4 py-2 text-[11px] text-muted-foreground">
                    Ngày công tính từ lần chấm đầu tiên của từng người — người chưa chấm lần nào không bị tính vắng.
                </p>
            )}
        </section>
    );
}
