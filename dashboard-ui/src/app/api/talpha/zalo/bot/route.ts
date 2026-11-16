import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { claimZaloRequest, finishZaloRequest, updateZaloStatus } from "@/lib/talpha/zalo-bot";
import { parseStoreImport, parseStoreOps } from "@/lib/talpha/zalo-bot-rules";
import { applyZaloStoreOps, importZaloStore, readZaloStore } from "@/lib/talpha/zalo-bot-store";

export const dynamic = "force-dynamic";

// Cửa của CHÍNH bot Zalo (ops/zalo-alerts/bot_control.js + bot_store.js, 16/11/2026) — chỉ chìa nội bộ x-talpha-token.
//
//   GET ?claim=1  → nhặt yêu cầu cũ nhất đang chờ (đánh dấu đang chạy) — {request: … | null}
//   GET ?store=1  → kho của bot (migration 0003): {state_rows, market_groups, session, session_unreadable}.
//                   session là phiên đăng nhập ĐÃ GIẢI MÃ — chỉ bot nhận, không ghi log.
//   POST          → {status: {logged_in, account_name, markets, groups, market_groups, pairing, last_error}}
//                   ghi trạng thái + nhịp tim; {finish: {id, ok, result}} đóng một yêu cầu;
//                   {store_ops: […]} ghi kho (một transaction); {import: {session, market_groups, state_rows}}
//                   chép file cũ của bot vào kho lần đầu (chỉ chỗ còn trống).

async function botOnly(req: NextRequest) {
    const a = await getAccess(req);
    return a?.kind === "internal";
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
    if (!(await botOnly(req))) return NextResponse.json({ error: "Chỉ bot Zalo gọi được" }, { status: 403 });
    const sp = req.nextUrl.searchParams;
    if (sp.get("store") === "1") return NextResponse.json(await readZaloStore(), { headers: NO_STORE });
    const request = sp.get("claim") === "1" ? await claimZaloRequest() : null;
    return NextResponse.json({ request }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
    if (!(await botOnly(req))) return NextResponse.json({ error: "Chỉ bot Zalo gọi được" }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Thiếu nội dung" }, { status: 400 });

    // Soát hết trước khi ghi gì: một phần hỏng thì bỏ cả lượt, bot giữ hàng và gửi lại.
    const ops = "store_ops" in body ? parseStoreOps(body.store_ops) : null;
    if (ops && "error" in ops) return NextResponse.json({ error: ops.error }, { status: 400 });
    const imported = "import" in body ? parseStoreImport(body.import) : null;
    if (imported && "error" in imported) return NextResponse.json({ error: imported.error }, { status: 400 });

    try {
        if (body.status && typeof body.status === "object") await updateZaloStatus(body.status);
        if (body.finish && Number.isFinite(Number(body.finish.id))) {
            await finishZaloRequest(Number(body.finish.id), Boolean(body.finish.ok), String(body.finish.result || ""));
        }
        if (ops) await applyZaloStoreOps(ops);
        const result = imported ? await importZaloStore(imported) : undefined;
        return NextResponse.json({ ok: true, ...(result ? { imported: result } : {}) });
    } catch (e) {
        // Lỗi chìa mã hoá / kho — trả chữ đọc được để bot ghi log; không kèm dữ liệu phiên.
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
}
