import { NextRequest, NextResponse } from "next/server";
import { getAccess } from "@/lib/talpha/access";
import { listCredentials, getCredential, verifyCredential, saveCredential, getCredentialsStatus } from "@/lib/talpha/khoa";
import { credentialValueError } from "@/lib/talpha/khoa-file";

export const dynamic = "force-dynamic";

// Khoá kết nối (04/11/2026) — trang /admin → Khoá kết nối. Chỉ giám đốc (API_RULES: full).
//
//   GET              → khoá nào đang dùng, lấy từ đâu (đã che, không bao giờ trả khoá thật);
//                      ?kiem=1 gọi thử mọi khoá đang dùng
//   POST {ten, gia_tri} → gọi thử khoá mới với dịch vụ thật, gọi được mới lưu
//   DELETE ?ten=     → bỏ khoá nhập trên trang, quay về khoá trong .env.local
//
// Xem lib/talpha/khoa.ts: lưu ở bảng api_credentials (mã hoá), vì sao không ghi vào .env.local.

export async function GET(req: NextRequest) {
    const credentials = getCredentialsStatus();
    if (req.nextUrl.searchParams.get("kiem") !== "1") return NextResponse.json({ khoa: credentials });
    const defs = listCredentials();
    const checkResults = await Promise.all(defs.map((d) => verifyCredential(d, getCredential(d.ten))));
    return NextResponse.json({ khoa: credentials.map((k, i) => ({ ...k, kiem: checkResults[i] })) });
}

export async function POST(req: NextRequest) {
    // Chỉ nhận JSON: trang khác không gửi được JSON kèm cookie đăng nhập mà không qua
    // bước hỏi trước của trình duyệt, nên khoá không thể bị thay từ một trang lạ.
    if (!(req.headers.get("content-type") || "").includes("application/json")) {
        return NextResponse.json({ error: "Chỉ nhận JSON" }, { status: 415 });
    }
    const body = await req.json().catch(() => null);
    const keyName = String(body?.ten || "");
    const value = String(body?.gia_tri || "").trim();
    const d = listCredentials().find((x) => x.ten === keyName);
    if (!d) return NextResponse.json({ error: `Không có khoá tên ${keyName}` }, { status: 400 });
    const validationError = credentialValueError(value);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const checkResult = await verifyCredential(d, value);
    if (!checkResult.ok) {
        return NextResponse.json({ error: `Chưa lưu — ${checkResult.chi_tiet}`, kiem: checkResult }, { status: 422 });
    }
    const a = await getAccess(req);
    const savedAt = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
    const actor = a?.email || a?.name || "?";
    try {
        await saveCredential(keyName, value, `${actor} lưu lúc ${savedAt}`, actor);
    } catch (e) {
        return NextResponse.json({ error: `Chưa lưu — ${e instanceof Error ? e.message : e}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, kiem: checkResult, khoa: getCredentialsStatus() });
}

export async function DELETE(req: NextRequest) {
    const keyName = req.nextUrl.searchParams.get("ten") || "";
    if (!listCredentials().some((x) => x.ten === keyName)) {
        return NextResponse.json({ error: `Không có khoá tên ${keyName}` }, { status: 400 });
    }
    await saveCredential(keyName, null, "");
    return NextResponse.json({ ok: true, khoa: getCredentialsStatus() });
}
