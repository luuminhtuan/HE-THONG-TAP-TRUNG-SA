import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { danhSachKhoa, docKhoa, kiemKhoa, luuKhoa, trangThaiKhoa } from "@/lib/talpha/khoa";
import { loiGiaTri } from "@/lib/talpha/khoa-file";

export const dynamic = "force-dynamic";

// Khoá kết nối (04/11/2026) — trang /admin → Khoá kết nối. Chỉ giám đốc (API_RULES: full).
//
//   GET              → khoá nào đang dùng, lấy từ đâu (đã che, không bao giờ trả khoá thật);
//                      ?kiem=1 gọi thử mọi khoá đang dùng
//   POST {ten, gia_tri} → gọi thử khoá mới với dịch vụ thật, gọi được mới lưu
//   DELETE ?ten=     → bỏ khoá nhập trên trang, quay về khoá trong .env.local
//
// Xem lib/talpha/khoa.ts: lưu ở đâu, vì sao không ghi vào .env.local.

export async function GET(req: NextRequest) {
    const ds = trangThaiKhoa();
    if (req.nextUrl.searchParams.get("kiem") !== "1") return NextResponse.json({ khoa: ds });
    const defs = danhSachKhoa();
    const kq = await Promise.all(defs.map((d) => kiemKhoa(d, docKhoa(d.ten))));
    return NextResponse.json({ khoa: ds.map((k, i) => ({ ...k, kiem: kq[i] })) });
}

export async function POST(req: NextRequest) {
    // Chỉ nhận JSON: trang khác không gửi được JSON kèm cookie đăng nhập mà không qua
    // bước hỏi trước của trình duyệt, nên khoá không thể bị thay từ một trang lạ.
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const body = await req.json().catch(() => null);
    const ten = String(body?.ten || "");
    const giaTri = String(body?.gia_tri || "").trim();
    const d = danhSachKhoa().find((x) => x.ten === ten);
    if (!d) return NextResponse.json({ error: `Không có khoá tên ${ten}` }, { status: 400 });
    const loi = loiGiaTri(giaTri);
    if (loi) return NextResponse.json({ error: loi }, { status: 400 });

    const kiem = await kiemKhoa(d, giaTri);
    if (!kiem.ok) {
        return NextResponse.json({ error: `Chưa lưu — ${kiem.chi_tiet}`, kiem }, { status: 422 });
    }
    const a = await getAccess(req);
    const luc = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
    await luuKhoa(ten, giaTri, `${a?.email || a?.name || "?"} lưu lúc ${luc}`);
    return NextResponse.json({ ok: true, kiem, khoa: trangThaiKhoa() });
}

export async function DELETE(req: NextRequest) {
    const ten = req.nextUrl.searchParams.get("ten") || "";
    if (!danhSachKhoa().some((x) => x.ten === ten)) {
        return NextResponse.json({ error: `Không có khoá tên ${ten}` }, { status: 400 });
    }
    await luuKhoa(ten, null, "");
    return NextResponse.json({ ok: true, khoa: trangThaiKhoa() });
}
