// ═══════════════════════════════════════════════════════════════════
// Chấm công online (20/11/2026) — phần ĐỤNG KHO (migration 0008: attendance_settings, attendance_punches). Phần thuần
// (soát IP / vị trí, tóm tắt ngày công): attendance-rules.ts.
//
// Sổ chấm CHỈ THÊM: chấm bù là thêm dòng source = 'manual', chấm sai là HUỶ (voided_at) — không xoá dòng nào.
// ═══════════════════════════════════════════════════════════════════
import { query, withTransaction } from "@/lib/db";
import { loadUsers } from "@/lib/users";
import { RULES } from "./rules";
import {
    FALLBACK_DEFAULTS, localParts, parseSettings, punchAllowed,
    type AttendanceDefaults, type AttendanceSettings, type PunchCheck, type PunchKind, type PunchRow,
} from "./attendance-rules";

/** talpha_rules.json → attendance (giá trị mặc định khi trang Quản trị chưa lưu cấu hình). */
export function attendanceDefaults(): AttendanceDefaults {
    const r = (RULES as unknown as { attendance?: Partial<AttendanceDefaults> }).attendance || {};
    return { ...FALLBACK_DEFAULTS, ...Object.fromEntries(Object.entries(r).filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null)) };
}

export type StoredSettings = { settings: AttendanceSettings; updated_by: string | null; updated_at: string | null; saved: boolean };

export async function loadAttendanceSettings(): Promise<StoredSettings> {
    const d = attendanceDefaults();
    const [row] = await query<{ config: unknown; updated_by: string | null; updated_at: string }>(
        "SELECT config, updated_by, updated_at FROM attendance_settings WHERE id = 1");
    return {
        settings: parseSettings(row?.config ?? null, d).settings,
        updated_by: row?.updated_by ?? null, updated_at: row?.updated_at ?? null, saved: !!row,
    };
}

export async function saveAttendanceSettings(s: AttendanceSettings, actor: string): Promise<void> {
    // Múi giờ + có tính giờ làm không: không lưu, luôn theo talpha_rules.json.
    const { timezone: _tz, schedule_enabled: _schedule, ...config } = s;
    await query(
        `INSERT INTO attendance_settings (id, config, updated_by, updated_at) VALUES (1, @config::jsonb, @actor, now())
         ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        { config: JSON.stringify(config), actor });
}

const PUNCH_COLUMNS = `id, user_id, kind, at, work_date, source, voided_at IS NOT NULL AS voided, ip, lat, lng, accuracy_m,
    location_name, distance_m, network_name, ip_ok, location_ok, note, created_by, voided_by, void_reason`;

/** Lần chấm trong khoảng ngày công [from, to] — `userIds` null = mọi người. */
export async function listPunches(userIds: string[] | null, from: string, to: string): Promise<PunchRow[]> {
    return query<PunchRow>(
        `SELECT ${PUNCH_COLUMNS} FROM attendance_punches
         WHERE work_date BETWEEN @from::date AND @to::date ${userIds ? "AND user_id = ANY(@userIds)" : ""}
         ORDER BY at, id`,
        { from, to, ...(userIds ? { userIds } : {}) });
}

/** Ngày bắt đầu tính công của từng người = ngày của lần chấm (còn hiệu lực) đầu tiên. */
export async function firstPunchDates(): Promise<Map<string, string>> {
    const rows = await query<{ user_id: string; first_date: string }>(
        "SELECT user_id, MIN(work_date) AS first_date FROM attendance_punches WHERE voided_at IS NULL GROUP BY user_id");
    return new Map(rows.map((r) => [r.user_id, r.first_date]));
}

export type AttendanceUser = { id: string; name: string; role: string };

/** Người dùng đang hoạt động (đã duyệt), xếp theo tên. */
export async function attendanceUsers(): Promise<AttendanceUser[]> {
    return (await loadUsers()).filter((u) => u.status !== "pending")
        .map((u) => ({ id: u.id, name: u.name || u.email, role: u.role }))
        .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/**
 * Ghi một lần tự chấm. Khoá theo người (advisory lock) để bấm hai lần liền không thành hai lần chấm vào. Trả lỗi đọc
 * được khi không chấm được loại này lúc này (đã chấm vào, chưa chấm vào mà bấm ra…).
 */
export async function recordPunch(p: {
    user_id: string; user_name: string; kind: PunchKind; check: PunchCheck;
    lat: number | null; lng: number | null; user_agent: string | null; tz: string;
}): Promise<{ ok: true; punch: PunchRow } | { ok: false; error: string }> {
    const workDate = localParts(Date.now(), p.tz).date;
    return withTransaction(async (q) => {
        await q("SELECT pg_advisory_xact_lock(hashtext(@key))", { key: `attendance:${p.user_id}` });
        const today = await q<PunchRow>(
            `SELECT ${PUNCH_COLUMNS} FROM attendance_punches WHERE user_id = @userId AND work_date = @workDate::date`,
            { userId: p.user_id, workDate });
        const rule = punchAllowed(p.kind, today, p.tz);
        if (!rule.ok) return rule;
        const [punch] = await q<PunchRow>(
            `INSERT INTO attendance_punches (user_id, user_name, kind, at, work_date, source, ip, lat, lng, accuracy_m,
                 location_name, distance_m, network_name, ip_ok, location_ok, user_agent, created_by)
             VALUES (@userId, @userName, @kind, now(), @workDate::date, 'self', @ip, @lat, @lng, @accuracy,
                 @locationName, @distance, @networkName, @ipOk, @locationOk, @userAgent, @userName)
             RETURNING ${PUNCH_COLUMNS}`,
            {
                userId: p.user_id, userName: p.user_name, kind: p.kind, workDate, ip: p.check.ip,
                lat: p.lat, lng: p.lng, accuracy: p.check.accuracy_m,
                locationName: p.check.location_name, distance: p.check.distance_m, networkName: p.check.network_name,
                ipOk: p.check.ip_ok, locationOk: p.check.location_ok, userAgent: p.user_agent?.slice(0, 300) ?? null,
            });
        return { ok: true as const, punch };
    });
}

/** Giám đốc chấm bù: giờ `time` của ngày `date` theo múi giờ chấm công, bắt buộc có ghi chú. */
export async function recordManualPunch(p: {
    user_id: string; user_name: string; kind: PunchKind; date: string; time: string; note: string; actor: string; tz: string;
}): Promise<PunchRow> {
    const [punch] = await query<PunchRow>(
        `INSERT INTO attendance_punches (user_id, user_name, kind, at, work_date, source, note, created_by)
         VALUES (@userId, @userName, @kind, (@date::date + @time::time) AT TIME ZONE @tz, @date::date, 'manual', @note, @actor)
         RETURNING ${PUNCH_COLUMNS}`,
        { userId: p.user_id, userName: p.user_name, kind: p.kind, date: p.date, time: p.time, tz: p.tz, note: p.note, actor: p.actor });
    return punch;
}

/** Huỷ một lần chấm (giữ dòng, ghi ai huỷ + lý do). false = không có, hoặc đã huỷ rồi. */
export async function voidPunch(id: number, actor: string, reason: string): Promise<boolean> {
    const rows = await query(
        `UPDATE attendance_punches SET voided_at = now(), voided_by = @actor, void_reason = @reason
         WHERE id = @id AND voided_at IS NULL RETURNING id`, { id, actor, reason });
    return rows.length > 0;
}
