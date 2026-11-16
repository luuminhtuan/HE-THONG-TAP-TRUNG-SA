import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { claimZaloRequest, finishZaloRequest, updateZaloStatus } from "@/lib/talpha/zalo-bot";

export const dynamic = "force-dynamic";

// Cửa của CHÍNH bot Zalo (ops/zalo-alerts/bot_control.js, 16/11/2026) — chỉ chìa nội bộ x-talpha-token.
//
//   GET ?claim=1  → nhặt yêu cầu cũ nhất đang chờ (đánh dấu đang chạy) — {request: … | null}
//   POST          → {status: {logged_in, account_name, markets, groups, market_groups, pairing, last_error}}
//                   ghi trạng thái + nhịp tim; {finish: {id, ok, result}} đóng một yêu cầu.

async function botOnly(req: NextRequest) {
    const a = await getAccess(req);
    return a?.kind === "internal";
}

export async function GET(req: NextRequest) {
    if (!(await botOnly(req))) return NextResponse.json({ error: "Chỉ bot Zalo gọi được" }, { status: 403 });
    const request = req.nextUrl.searchParams.get("claim") === "1" ? await claimZaloRequest() : null;
    return NextResponse.json({ request }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    if (!(await botOnly(req))) return NextResponse.json({ error: "Chỉ bot Zalo gọi được" }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Thiếu nội dung" }, { status: 400 });
    if (body.status && typeof body.status === "object") await updateZaloStatus(body.status);
    if (body.finish && Number.isFinite(Number(body.finish.id))) {
        await finishZaloRequest(Number(body.finish.id), Boolean(body.finish.ok), String(body.finish.result || ""));
    }
    return NextResponse.json({ ok: true });
}
