import { NextRequest, NextResponse } from "next/server";
import { getAccess, unauthorized, forbidden } from "@/lib/talpha/access";
import { attendanceDefaults, loadAttendanceSettings, saveAttendanceSettings } from "@/lib/talpha/attendance";
import { clientIpFromHeaders, describeRule, parseSettings } from "@/lib/talpha/attendance-rules";

export const dynamic = "force-dynamic";

// Cấu hình chấm công (20/11/2026) — /admin → Chấm công, chỉ giám đốc (proxy chặn theo API_RULES, route soát lại).
//   GET → {settings, defaults, saved, updated_by, updated_at, ip}   — ip = IP máy chủ đang thấy của người mở trang
//   PUT {settings} → lưu (sai thì 400 + errors, không lưu gì)
const NO_STORE = { "Cache-Control": "no-store" };

async function payload(req: NextRequest) {
    const stored = await loadAttendanceSettings();
    return {
        ...stored, defaults: attendanceDefaults(), rule_text: describeRule(stored.settings),
        ip: clientIpFromHeaders((n) => req.headers.get(n)),
    };
}

export async function GET(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    if (!a.full) return forbidden("Chỉ giám đốc xem được cấu hình chấm công");
    try {
        return NextResponse.json(await payload(req), { headers: NO_STORE });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    const a = await getAccess(req);
    if (!a) return unauthorized();
    if (!a.full || a.kind === "internal") return forbidden("Chỉ giám đốc sửa được cấu hình chấm công");
    const body = await req.json().catch(() => null) as { settings?: unknown } | null;
    const { settings, errors } = parseSettings(body?.settings ?? null, attendanceDefaults());
    if (!body?.settings) errors.push("Thiếu cấu hình");
    if (errors.length) return NextResponse.json({ error: errors.join(" · "), errors }, { status: 400 });
    try {
        const actor = a.name || a.email || "giám đốc";
        await saveAttendanceSettings(settings, actor);
        console.log(`[attendance] ${actor} lưu cấu hình: ${describeRule(settings)} · ${settings.networks.length} mạng · ${settings.locations.length} điểm`);
        return NextResponse.json({ ok: true, ...(await payload(req)) });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
}
