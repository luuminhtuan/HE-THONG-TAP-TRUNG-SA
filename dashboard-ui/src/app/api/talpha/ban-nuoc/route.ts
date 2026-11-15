import { NextRequest, NextResponse } from "next/server";
import { docBan } from "@/lib/talpha/ban-nuoc-kho";

export const dynamic = "force-dynamic";

// Số theo NƯỚC × NGÀY × NGƯỜI của một tháng (15/11/2026) — bảng market_monthly_reports do vòng ghi
// Sheet (format_all.py) ghi mỗi giờ. Bot Zalo gọi bằng chìa nội bộ, thay cho việc đọc file
// data/bao_cao_nuoc/<tháng>.json. Chỉ giám đốc / chìa nội bộ (API_RULES: full).
//
//   GET ?thang=YYYY-MM  → nội dung bản số, hoặc 404 nếu vòng ghi Sheet chưa ghi tháng đó

export async function GET(req: NextRequest) {
    const thang = req.nextUrl.searchParams.get("thang") || "";
    if (!/^\d{4}-\d{2}$/.test(thang)) return NextResponse.json({ error: "thang phải dạng YYYY-MM" }, { status: 400 });
    const ban = await docBan(thang);
    if (!ban) return NextResponse.json({ error: `Chưa có bản số tháng ${thang}` }, { status: 404 });
    return NextResponse.json(ban);
}
