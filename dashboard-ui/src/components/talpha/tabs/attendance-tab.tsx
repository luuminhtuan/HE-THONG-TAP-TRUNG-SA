"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shiftMonth } from "@/lib/talpha/attendance-rules";
import SearchableSelect from "@/components/ui/searchable-select";
import { useUpdateUrlParams } from "../url-state";
import PunchCard from "./attendance/punch-card";
import MonthCalendar, { MonthTotalsBar } from "./attendance/month-calendar";
import DayDetail from "./attendance/day-detail";
import TeamTable from "./attendance/team-table";
import { STATUS, type AttendanceData } from "./attendance/types";

// ═══════════════════════════════════════════════════════════════════
// Tab 🕒 Chấm công (20/11/2026) — ai đăng nhập cũng thấy (PERSONAL_TABS ở access-rules.ts).
//   • Khung chấm vào / chấm ra của chính mình, soát IP + vị trí theo cấu hình /admin → Chấm công.
//   • Lịch tháng: giờ vào → giờ ra từng ngày, màu theo trạng thái; bấm ngày xem từng lần chấm (IP, vị trí).
//   • Giám đốc: chọn người để xem lịch, chấm bù / huỷ lần chấm sai, bảng tổng cả công ty.
// Tháng + người đang xem nằm trên địa chỉ (?month=2026-11&user=<id>) — gửi link là mở đúng chỗ. Nguồn:
// /api/talpha/attendance (bảng attendance_punches, migration 0008).
// ═══════════════════════════════════════════════════════════════════
const LEGEND_SCHEDULE = ["ok", "late", "early", "working", "missing_out", "absent", "off_worked", "off"] as const;
// Không tính giờ làm (talpha_rules.json → attendance.schedule_enabled = false, 20/11/2026).
const LEGEND_PLAIN = ["done", "working", "missing_out"] as const;

export default function AttendanceTab() {
    const sp = useSearchParams();
    const patch = useUpdateUrlParams();
    const monthParam = sp.get("month");
    const userParam = sp.get("user");
    const [data, setData] = useState<AttendanceData | null>(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const q = new URLSearchParams();
        if (monthParam) q.set("month", monthParam);
        if (userParam) q.set("user_id", userParam);
        try {
            const r = await fetch(`/api/talpha/attendance?${q}`, { cache: "no-store" });
            const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setData(j);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Không tải được chấm công");
        } finally {
            setLoading(false);
        }
    }, [monthParam, userParam]);
    useEffect(() => { load(); }, [load]);

    // Ngày đang xem chi tiết: giữ nếu còn trong tháng, không thì hôm nay (nếu thuộc tháng đang xem).
    useEffect(() => {
        if (!data) return;
        setSelected((s) => (s && s.startsWith(data.month) ? s : data.today.startsWith(data.month) ? data.today : null));
    }, [data]);

    const userOptions = useMemo(
        () => (data?.users || []).map((u) => ({ value: u.id, label: u.name, hint: u.id === data?.me?.id ? "bạn" : undefined })),
        [data?.users, data?.me?.id]);

    if (!data && !error) {
        return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;
    }

    const month = data?.month || monthParam || "";
    const goMonth = (m: string | null) => patch({ month: m });
    const pickUser = (id: string) => patch({ user: id && id !== data?.me?.id ? id : null });
    const cal = data?.calendar;
    const selectedDay = cal && selected ? cal.days.find((d) => d.date === selected) : null;
    const isOwnCalendar = !!data?.user && data.user.id === data.me?.id;

    return (
        <div className="space-y-4">
            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {data && <PunchCard data={data} onPunched={load} />}

            {data && (
                <section className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                            <CalendarDays className="h-4 w-4 text-orange-500" />
                            Lịch chấm công{data.user && !isOwnCalendar ? ` — ${data.user.name}` : ""}
                        </h2>
                        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                            {data.can_manage && userOptions.length > 0 && (
                                <SearchableSelect
                                    options={userOptions}
                                    value={data.user?.id}
                                    onChange={pickUser}
                                    placeholder="Chọn người"
                                    ariaLabel="Xem chấm công của"
                                    align="right"
                                    className="w-48"
                                />
                            )}
                            <div className="flex items-center rounded-lg border border-border bg-card">
                                <button type="button" onClick={() => goMonth(shiftMonth(month, -1))} className="rounded-l-lg p-2 hover:bg-muted" aria-label="Tháng trước">
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <span className="min-w-[96px] text-center text-sm font-medium tabular-nums text-foreground">
                                    Tháng {month.slice(5)}/{month.slice(0, 4)}
                                </span>
                                <button type="button" onClick={() => goMonth(shiftMonth(month, 1))} className="rounded-r-lg p-2 hover:bg-muted" aria-label="Tháng sau">
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                            {month !== data.today.slice(0, 7) && (
                                <button type="button" onClick={() => goMonth(null)}
                                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted">
                                    Tháng này
                                </button>
                            )}
                        </div>
                    </div>

                    {cal ? (
                        <>
                            <MonthTotalsBar totals={cal.totals} scheduleEnabled={data.settings.schedule_enabled} />
                            <div className="rounded-xl border border-border bg-card p-2 md:p-3">
                                <MonthCalendar days={cal.days} today={data.today} selected={selected} onSelect={setSelected} />
                                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                    {(data.settings.schedule_enabled ? LEGEND_SCHEDULE : LEGEND_PLAIN).map((k) => (
                                        <span key={k} className="inline-flex items-center gap-1">
                                            <span className={cn("inline-block h-2.5 w-2.5 rounded-sm border", STATUS[k].cell)} /> {STATUS[k].label}
                                        </span>
                                    ))}
                                    {data.settings.schedule_enabled
                                        ? <span>· Ca {data.settings.shift_start}–{data.settings.shift_end}, ngày làm: {data.settings.workdays.map((w) => (w === 7 ? "CN" : `T${w + 1}`)).join(" ")}</span>
                                        : <span>· Một ngày chấm được nhiều ca (vào → ra → vào…), giờ làm = tổng các ca</span>}
                                </div>
                            </div>
                            {selectedDay && data.user && (
                                <DayDetail
                                    key={`${data.user.id}-${selectedDay.date}`}
                                    day={selectedDay}
                                    punches={cal.punches.filter((p) => p.work_date === selectedDay.date)}
                                    tz={data.timezone}
                                    today={data.today}
                                    canManage={data.can_manage}
                                    userId={data.user.id}
                                    onChanged={load}
                                />
                            )}
                        </>
                    ) : (
                        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Chọn người để xem lịch chấm công.</p>
                    )}
                </section>
            )}

            {data?.can_manage && data.team && data.team.length > 0 && (
                <TeamTable team={data.team} today={data.today} month={month} selectedId={data.user?.id ?? null} onSelect={pickUser}
                    scheduleEnabled={data.settings.schedule_enabled} />
            )}
        </div>
    );
}
