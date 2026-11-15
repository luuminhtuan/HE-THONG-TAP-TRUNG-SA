import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { danhSachKhoa, docKhoa } from "@/lib/talpha/khoa";

export const dynamic = "force-dynamic";

// Xem khoá đang dùng (15/11/2026) — nút con mắt ở /admin → Khoá kết nối và Thị trường. Chỉ giám đốc
// (API_RULES: /api/talpha/khoa là full). Danh sách khoá (GET /api/talpha/khoa) vẫn chỉ trả bản che;
// khoá thật chỉ ra khi người bấm xem đúng MỘT khoá, và mỗi lần xem đều ghi log (ai, khoá nào).
//
//   POST {ten} → { ten, gia_tri }    (gia_tri rỗng = chưa có khoá)

const LA_KEY_POS = /^TALPHA_POSCAKE_[A-Z]{2,3}_KEY$/;

export async function POST(req: NextRequest) {
    // Chỉ nhận JSON: trang lạ không gửi được JSON kèm cookie đăng nhập mà không qua bước hỏi trước.
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const a = await getAccess(req);
    // Chìa nội bộ (bot, việc nền) không bao giờ cần đọc khoá qua đây.
    if (!a || a.kind === "internal") return NextResponse.json({ error: "Không có quyền xem khoá" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const ten = String(body?.ten || "");
    // Key POS của nước mới thêm chưa có trong danhSachKhoa tới khi dashboard khởi động lại.
    if (!LA_KEY_POS.test(ten) && !danhSachKhoa().some((d) => d.ten === ten)) {
        return NextResponse.json({ error: `Không có khoá tên ${ten}` }, { status: 400 });
    }
    console.log(`[khoa] ${a.email || a.name || "?"} xem khoá ${ten}`);
    return NextResponse.json({ ten, gia_tri: docKhoa(ten) }, { headers: { "Cache-Control": "no-store" } });
}
