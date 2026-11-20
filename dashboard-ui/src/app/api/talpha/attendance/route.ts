import { NextRequest, NextResponse } from "next/server";
import { getAccess, unauthorized } from "@/lib/talpha/access";
import {
    attendanceUsers, firstPunchDates, listPunches, loadAttendanceSettings, recordManualPunch, recordPunch, voidPunch,
} from "@/lib/talpha/attendance";
import {
    clientIpFromHeaders, describeRule, evaluatePunch, isMonth, localParts, monthDays, parseAttendanceAction,
    publicSettings, summarizeDay, summarizeMonth, type PunchRow,
} from "@/lib/talpha/attendance-rules";

export const dynamic = "force-dynamic";

// Chấm công online (20/11/2026) — tab 🕒 Chấm công. MỌI người đăng nhập tự chấm vào / ra cho CHÍNH MÌNH và xem lịch của
// mình; giám đốc (full) xem lịch mọi người, bảng tổng cả công ty, chấm bù và huỷ lần chấm sai. Cấu hình nơi chấm:
// /api/talpha/attendance/settings (chỉ giám đốc).
//   GET ?month=YYYY-MM[&user_id=]   → lịch tháng + hôm nay của tôi (+ users, team khi là giám đốc)
//   POST {action: "check", geo}     → soát IP + vị trí lúc này, không ghi gì (nút "Kiểm tra" ở tab và trang Quản trị)
//   POST {action: "punch", kind: "in" | "out", geo}
//   POST {action: "manual", user_id, kind, date, time, note}   — giám đốc chấm bù
//   POST {action: "void", punch_id, reason}                    — giám đốc huỷ một lần chấm
const NO_STORE = { "Cache-Control": "no-store" };
const err = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const sp = req.nextUrl.searchParams;
    try {
        const { settings } = await loadAttendanceSettings();
        const tz = settings.timezone;
        const now = localParts(Date.now(), tz);
        const monthParam = sp.get("month");
        const month = isMonth(monthParam) ? monthParam : now.date.slice(0, 7);
        const selfId = a.kind === "user" ? a.id : null;
        const users = a.full ? await attendanceUsers() : [];

        let targetId = selfId;
        const wanted = sp.get("user_id");
        if (wanted && wanted !== selfId) {
            if (!a.full) return err(403, "Chỉ giám đốc xem được chấm công của người khác");
            if (!users.some((u) => u.id === wanted)) return err(404, "Không có người dùng này");
            targetId = wanted;
        }

        const days = monthDays(month);
        const ids = a.full ? null : selfId ? [selfId] : [];
        const [monthPunches, todayPunches, firsts] = await Promise.all([
            ids && !ids.length ? [] : listPunches(ids, days[0], days[days.length - 1]),
            ids && !ids.length ? [] : listPunches(ids, now.date, now.date),
            firstPunchDates(),
        ]);
        const of = (rows: PunchRow[], id: string | null) => rows.filter((p) => p.user_id === id);

        const myToday = selfId ? of(todayPunches, selfId) : [];
        const targetMonth = targetId ? of(monthPunches, targetId) : [];
        const targetName = targetId === selfId ? a.name : users.find((u) => u.id === targetId)?.name ?? "";

        return NextResponse.json({
            timezone: tz, today: now.date, now_hhmm: now.hhmm, month,
            settings: publicSettings(settings), rule_text: describeRule(settings),
            me: selfId ? { id: selfId, name: a.name } : null,
            can_manage: a.full,
            my_today: selfId ? { summary: summarizeDay(now.date, myToday, settings, now.date, firsts.get(selfId) ?? now.date), punches: myToday } : null,
            user: targetId ? { id: targetId, name: targetName } : null,
            calendar: targetId ? { ...summarizeMonth(month, targetMonth, settings, now.date, firsts.get(targetId) ?? null), punches: targetMonth } : null,
            ...(a.full ? {
                users,
                team: users.map((u) => ({
                    ...u,
                    totals: summarizeMonth(month, of(monthPunches, u.id), settings, now.date, firsts.get(u.id) ?? null).totals,
                    today: summarizeDay(now.date, of(todayPunches, u.id), settings, now.date, firsts.get(u.id) ?? null),
                })),
            } : {}),
        }, { headers: NO_STORE });
    } catch (e) {
        return err(500, e instanceof Error ? e.message : String(e));
    }
}

export async function POST(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    const parsed = parseAttendanceAction(await req.json().catch(() => null));
    if ("error" in parsed) return err(400, parsed.error);
    try {
        const { settings } = await loadAttendanceSettings();
        const tz = settings.timezone;
        const ip = clientIpFromHeaders((n) => req.headers.get(n));

        if (parsed.action === "check") {
            return NextResponse.json({ check: evaluatePunch(settings, ip, parsed.geo) }, { headers: NO_STORE });
        }

        if (parsed.action === "punch") {
            if (a.kind !== "user" || !a.id) return err(403, "Chỉ tài khoản đăng nhập mới chấm công được");
            const check = evaluatePunch(settings, ip, parsed.geo);
            if (!check.allowed) return err(403, check.problems.join(" · ") || "Chưa đạt điều kiện chấm công", { check });
            const r = await recordPunch({
                user_id: a.id, user_name: a.name, kind: parsed.kind, check,
                lat: parsed.geo?.lat ?? null, lng: parsed.geo?.lng ?? null,
                user_agent: req.headers.get("user-agent"), tz,
            });
            if (!r.ok) return err(409, r.error, { check });
            console.log(`[attendance] ${a.email || a.name} chấm ${parsed.kind === "in" ? "vào" : "ra"} · IP ${ip ?? "?"}`
                + (check.location_name ? ` · ${check.location_name} ${check.distance_m} m` : ""));
            return NextResponse.json({ ok: true, punch: r.punch, check });
        }

        // Chấm bù / huỷ: chỉ giám đốc. Bot (chìa nội bộ) không sửa sổ chấm công.
        if (!a.full || a.kind === "internal") return err(403, "Chỉ giám đốc chấm bù / huỷ lần chấm được");
        const actor = a.name || a.email || "giám đốc";

        if (parsed.action === "manual") {
            const user = (await attendanceUsers()).find((u) => u.id === parsed.user_id);
            if (!user) return err(404, "Không có người dùng này");
            if (parsed.date > localParts(Date.now(), tz).date) return err(400, "Không chấm bù cho ngày chưa tới");
            const punch = await recordManualPunch({ ...parsed, user_name: user.name, actor, tz });
            console.log(`[attendance] ${actor} chấm bù ${parsed.kind} cho ${user.name} ${parsed.date} ${parsed.time}`);
            return NextResponse.json({ ok: true, punch });
        }

        const ok = await voidPunch(parsed.punch_id, actor, parsed.reason);
        if (!ok) return err(404, "Không có lần chấm này, hoặc đã huỷ rồi");
        console.log(`[attendance] ${actor} huỷ lần chấm #${parsed.punch_id}: ${parsed.reason}`);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return err(500, e instanceof Error ? e.message : String(e));
    }
}
