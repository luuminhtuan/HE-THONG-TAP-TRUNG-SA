import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { SHOP2MKT } from "@/lib/talpha/rules";
import { enqueueZaloRequest, getZaloOverview } from "@/lib/talpha/zalo-bot";
import { parseZaloRequest } from "@/lib/talpha/zalo-bot-rules";

export const dynamic = "force-dynamic";

// Bot Zalo điều khiển từ trang (16/11/2026) — /admin → Khoá kết nối → Zalo. Chỉ giám đốc (API_RULES full).
//
//   GET   → trạng thái bot (đăng nhập chưa, nick nào, nhóm từng nước, mã QR đang chờ quét) + yêu cầu gần đây
//   POST  {action, payload} → ghi yêu cầu cho bot: pair · refresh_groups · set_group {market, group_id} ·
//         send_test {market} · unpair. Bot (ops/zalo-alerts/bot_control.js) nhặt trong vài giây.

export async function GET() {
    return NextResponse.json(await getZaloOverview(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    // Chỉ nhận JSON: trang lạ không gửi được JSON kèm cookie đăng nhập mà không qua bước hỏi trước.
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const a = await getAccess(req);
    if (!a || a.kind === "internal") return NextResponse.json({ error: "Không có quyền điều khiển bot" }, { status: 403 });

    const overview = await getZaloOverview();
    // Bot không chạy thì KHÔNG xếp yêu cầu: để dồn lại là lúc bot bật lên nó gửi tin thử / đổi nhóm bất ngờ.
    if (!overview.online) {
        return NextResponse.json({
            error: "Bot Zalo chưa chạy trên máy chủ — bật bot rồi bấm lại (Docker: docker compose --profile zalo up -d zalo).",
            ...overview,
        }, { status: 409 });
    }
    const markets = overview.status?.markets?.length ? overview.status.markets : Object.keys(SHOP2MKT);
    const parsed = parseZaloRequest(await req.json().catch(() => null), markets);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const actor = a.email || a.name || "?";
    const { id, duplicate } = await enqueueZaloRequest(parsed, actor);
    console.log(`[zalo] ${actor} yêu cầu ${parsed.action} ${JSON.stringify(parsed.payload)} (#${id}${duplicate ? ", đã có" : ""})`);
    return NextResponse.json({ ok: true, id, da_co: duplicate, ...(await getZaloOverview()) });
}
