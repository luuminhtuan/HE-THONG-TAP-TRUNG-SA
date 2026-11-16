import { NextRequest, NextResponse } from "next/server";
import { readStoreFresh } from "@/lib/talpha/store";
import { getAccess } from "@/lib/talpha/access";
import { canWriteCodAction } from "@/lib/talpha/access-rules";
import { emptyActions, type CodActions } from "@/lib/talpha/cod-actions";
import { recordCodAction, deleteCodAction, type CodActionBody } from "@/lib/talpha/cod-actions-store";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// VIỆC NGƯỜI LÀM TRONG ĐỐI SOÁT
//
//   GET    — đọc lại toàn bộ (màn hình tự dựng từ đây + order-ledger)
//   POST   — ghi một việc: tiền về tài khoản, đã đòi, đã hỏi, bỏ qua
//   DELETE — huỷ một việc đã ghi (bấm nhầm)
//
// Route này CHỈ ghi thứ do người quyết. Mọi con số máy tự đọc ra từ file sao kê
// vẫn nằm ở cod-recon và order-ledger — không trộn hai loại vào một kho, vì
// nạp lại file thì số máy đọc phải được tính lại còn việc người làm thì không.
// ═══════════════════════════════════════════════════════════════════

const STORE = "cod_actions";

/** Việc kế toán (tiền về, hỏi/bỏ qua khoản lệch, huỷ) chỉ leader + giám đốc — xem ghiCodDuoc. */
const forbidden = () => NextResponse.json(
    { error: "Việc này thuộc mục Kế toán — chỉ leader của nước và giám đốc được ghi" }, { status: 403 });

export async function GET() {
    const a = await readStoreFresh<CodActions>(STORE, emptyActions());
    return NextResponse.json({ bank: a.bank || {}, done: a.done || {} });
}

export async function POST(req: NextRequest) {
    let body: CodActionBody;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Body không phải JSON" }, { status: 400 });
    }
    const a = await getAccess(req);
    if (!a || !canWriteCodAction(a, String(body.kind || ""), body.viec)) return forbidden();
    // Luật ghi (tiền về, đã đòi/hỏi/bỏ qua) dùng chung với các nước khác — lib/talpha/cod-actions-store.ts.
    const r = await recordCodAction(STORE, body);
    return NextResponse.json(r.json, { status: r.status });
}

export async function DELETE(req: NextRequest) {
    const a = await getAccess(req);
    if (!a || !canWriteCodAction(a, "xoa")) return forbidden();
    const q = req.nextUrl.searchParams;
    const r = await deleteCodAction(STORE, q.get("kind"), String(q.get("key") || "").trim());
    return NextResponse.json(r.json, { status: r.status });
}
