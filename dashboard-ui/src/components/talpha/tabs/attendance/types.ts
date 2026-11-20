import type {
    DayStatus, DaySummary, MonthTotals, PublicAttendanceSettings, PunchCheck, PunchRow,
} from "@/lib/talpha/attendance-rules";

export type { DaySummary, MonthTotals, PunchCheck, PunchRow };

export type AttendanceUserRow = { id: string; name: string; role: string };

/** GET /api/talpha/attendance */
export type AttendanceData = {
    timezone: string; today: string; now_hhmm: string; month: string;
    settings: PublicAttendanceSettings; rule_text: string;
    me: { id: string; name: string } | null;
    can_manage: boolean;
    my_today: { summary: DaySummary; punches: PunchRow[] } | null;
    user: { id: string; name: string } | null;
    calendar: { days: DaySummary[]; totals: MonthTotals; punches: PunchRow[] } | null;
    users?: AttendanceUserRow[];
    team?: (AttendanceUserRow & { totals: MonthTotals; today: DaySummary })[];
};

/** Nhãn + màu từng trạng thái ngày công (ô lịch, bảng tổng). */
export const STATUS: Record<DayStatus, { label: string; cell: string; badge: string }> = {
    ok: {
        label: "Đúng giờ",
        cell: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10",
        badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    },
    done: {
        label: "Đủ vào – ra",
        cell: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10",
        badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    },
    late: {
        label: "Đi muộn",
        cell: "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    },
    early: {
        label: "Về sớm",
        cell: "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    },
    late_early: {
        label: "Muộn + về sớm",
        cell: "border-orange-200 bg-orange-50 dark:border-orange-500/20 dark:bg-orange-500/10",
        badge: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    },
    working: {
        label: "Đang làm",
        cell: "border-sky-200 bg-sky-50 dark:border-sky-500/20 dark:bg-sky-500/10",
        badge: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    },
    missing_out: {
        label: "Thiếu giờ ra",
        cell: "border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10",
        badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    },
    missing_in: {
        label: "Thiếu giờ vào",
        cell: "border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10",
        badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    },
    absent: {
        label: "Vắng",
        cell: "border-rose-300 bg-rose-100/70 dark:border-rose-500/30 dark:bg-rose-500/15",
        badge: "bg-rose-200 text-rose-800 dark:bg-rose-500/25 dark:text-rose-200",
    },
    pending: {
        label: "Chưa chấm",
        cell: "border-border bg-card",
        badge: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
    },
    off: {
        label: "Nghỉ",
        cell: "border-transparent bg-muted/50",
        badge: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400",
    },
    off_worked: {
        label: "Làm ngày nghỉ",
        cell: "border-violet-200 bg-violet-50 dark:border-violet-500/20 dark:bg-violet-500/10",
        badge: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
    },
    none: { label: "", cell: "border-border/60 bg-card", badge: "" },
    future: { label: "", cell: "border-border/60 bg-card", badge: "" },
    untracked: { label: "", cell: "border-border/60 bg-card", badge: "" },
};

export const WEEKDAY_SHORT = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** 537 → "8g57" — gọn cho ô lịch. */
export function fmtShort(min: number | null | undefined): string {
    if (!min) return "";
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}g${m ? String(m).padStart(2, "0") : ""}` : `${m}′`;
}

/** 537 → "8 giờ 57" */
export function fmtDuration(min: number | null | undefined): string {
    if (!min) return "—";
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} giờ${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} phút`;
}

/** Thời điểm ISO → "HH:MM" theo múi giờ chấm công. */
export function hhmm(iso: string | null | undefined, tz: string): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("vi-VN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "2026-11-20" → "Thứ Sáu, 20/11/2026" */
export function fmtDateLong(date: string): string {
    const [y, m, d] = date.split("-").map(Number);
    const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const names = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
    return `${names[w]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export async function postAttendance<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T & { error?: string }> {
    const r = await fetch("/api/talpha/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok && !j.error) j.error = `HTTP ${r.status}`;
    return j;
}
