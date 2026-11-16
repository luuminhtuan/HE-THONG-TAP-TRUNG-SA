import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getAccess } from "@/lib/talpha/access";
import { getRefreshStatus } from "@/lib/talpha/refresh-status";

export const dynamic = "force-dynamic";

// Cập nhật số (15/11/2026) — đèn trạng thái + nút "Cập nhật ngay" trên thanh đầu dashboard. Mọi người
// đăng nhập đều xem và bấm được (API_RULES: tabs "*").
//
//   GET   → đang cập nhật không, số mới tới lúc nào, vòng báo cáo gần nhất, TKQC / shop đọc lỗi
//   POST  → ghi yêu cầu "Cập nhật ngay"; lịch việc nền (ops/docker/lich.py) nhặt trong ~15 giây, kéo
//           số rồi dựng báo cáo (1–3 phút). Đang có yêu cầu chờ / đang chạy thì không ghi thêm.

/** Vừa cập nhật xong thì chờ chừng này mới cho bấm lại — Meta, POS giới hạn số lượt gọi. */
const COOLDOWN_MINUTES = 3;

export async function GET() {
    return NextResponse.json(await getRefreshStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    // Chỉ nhận JSON: trang lạ không gửi được JSON kèm cookie đăng nhập mà không qua bước hỏi trước.
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const a = await getAccess(req);
    const refreshStatus = await getRefreshStatus();
    if (!refreshStatus.co_lich) {
        return NextResponse.json({
            error: "Máy này chưa có lịch việc nền nhận lệnh cập nhật (chỉ bản chạy bằng Docker có). Số vẫn tự cập nhật mỗi giờ.",
            ...refreshStatus,
        }, { status: 409 });
    }
    if (refreshStatus.yeu_cau && (refreshStatus.yeu_cau.status === "pending" || refreshStatus.yeu_cau.status === "running")) {
        return NextResponse.json({ ok: true, da_co: true, ...refreshStatus });
    }
    const finishedAt = refreshStatus.yeu_cau?.finished_at ? Date.parse(refreshStatus.yeu_cau.finished_at) : 0;
    if (refreshStatus.yeu_cau?.status === "ok" && Date.now() - finishedAt < COOLDOWN_MINUTES * 60_000) {
        return NextResponse.json({
            error: `Số vừa cập nhật lúc ${new Date(finishedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })} — chờ vài phút rồi bấm lại.`,
            ...refreshStatus,
        }, { status: 429 });
    }
    const actor = a?.email || a?.name || "?";
    await query("INSERT INTO refresh_requests (requested_by) VALUES (@ai)", { ai: actor });
    console.log(`[refresh] ${actor} bấm Cập nhật ngay`);
    return NextResponse.json({ ok: true, ...(await getRefreshStatus()) });
}
