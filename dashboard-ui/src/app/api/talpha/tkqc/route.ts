// /admin → TKQC (04/11/2026): danh bạ TKQC tự động — mọi TKQC token Meta đọc được, chi tiêu 7 / 30 ngày,
// loại của từng TK (vào báo cáo hay không). Thay trang TKQC Manager cũ (ghi ad_accounts.json mà sync không
// đọc). Chỉ giám đốc (access-rules → API_RULES).
//   GET                         danh bạ + các loại khai trong talpha_rules.json → tkqc_loai
//   POST {account_id, loai, ghi_chu?}   đổi loại — có tác dụng ngay ở mọi báo cáo
//   POST {action: "quet"}       hỏi Meta ngay bằng token đang lưu (khỏi chờ vòng sync đầu giờ)
import { NextRequest, NextResponse } from "next/server";
import { danhBa, doiLoai, quetNgay } from "@/lib/talpha/tkqc";
import { cacLoai } from "@/lib/talpha/tkqc-luat";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        return NextResponse.json({ loai: cacLoai(), tkqc: await danhBa() });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Thân yêu cầu phải là JSON" }, { status: 400 });
    }
    try {
        if (body?.action === "quet") return NextResponse.json(await quetNgay());
        const id = String(body?.account_id || "");
        if (!/^(act_)?\d+$/.test(id)) return NextResponse.json({ error: "account_id lạ" }, { status: 400 });
        const ghi = typeof body?.ghi_chu === "string" ? body.ghi_chu.slice(0, 500) : null;
        await doiLoai(id, String(body?.loai || ""), ghi);
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
    }
}
