import { NextRequest, NextResponse } from "next/server";
import { readStoreFresh, updateStore } from "@/lib/talpha/store";
import { MAX_UPLOAD_BYTES, tooBigMessage } from "@/lib/talpha/upload-limit";
import { STORE, emptyStore } from "./_lib/statement-store";
import { warnings } from "./_lib/statement-warnings";
import { buildReconciliation } from "./_lib/reconcile-report";
import { saveNazaStatement, saveCsvStatement } from "./_lib/upload-statement";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// ĐỐI SOÁT COD
//
//   POST  — nhận file sao kê 3PL, lưu vào kho, trả kết quả khớp ngay
//   GET   — đối soát lại kỳ đang chọn với bản sao kê đã lưu
//   DELETE— xoá một bản sao kê đã tải lên
//
// Chỉ đối chiếu ĐƠN ĐÃ GIAO trong kỳ: đơn chưa giao thì 3PL chưa có lý do trả
// tiền, đưa vào chỉ đẻ ra báo động giả.
//
// HAI ĐỊNH DẠNG:
//   .xlsx — sao kê NAZA供应链, ba sheet (TỔNG · COD · PHÍ). Đọc được cả phép
//           quyết toán lẫn phí từng đơn, nên soát được cả tiền lẫn phí.
//   .csv  — đường lui cho đối tác khác hoặc file đã xuất tay. Chỉ có tiền COD.
//
// Phần nặng nằm ở _lib/: reconcile-report.ts (GET), upload-statement.ts (POST),
// delivered-orders.ts (đơn đã giao: POS + file đối tác), statement-store.ts (kho sao kê),
// statement-warnings.ts (cảnh báo về chính bản sao kê).
// ═══════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const from = q.get("from") || "";
    const to = q.get("to") || "";
    const statementId = q.get("statement") || "";

    const store = await readStoreFresh(STORE, emptyStore());
    const list = store.statements.map((s) => ({
        id: s.id, filename: s.filename, uploaded_at: s.uploaded_at,
        row_count: s.row_count, detected_columns: s.detected_columns,
        missing_columns: s.missing_columns,
        kind: s.naza ? "naza" : "csv",
    }));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return NextResponse.json({ statements: list, warnings: warnings(), result: null });
    }

    const chosen = statementId
        ? store.statements.find((s) => s.id === statementId)
        : store.statements[store.statements.length - 1];

    try {
        return NextResponse.json(await buildReconciliation(store, chosen, list, from, to));
    } catch (e) {
        console.error("cod-recon GET lỗi:", e);
        return NextResponse.json({ error: "Query lỗi" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
            return NextResponse.json({ error: "Thiếu file sao kê" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: tooBigMessage() }, { status: 413 });
        }
        const mkId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

        // ── Sao kê NAZA (.xlsx) ──────────────────────────────────────────
        if (/\.xlsx$/i.test(file.name)) {
            return await saveNazaStatement(file, mkId);
        }

        return await saveCsvStatement(file, mkId);
    } catch (e) {
        console.error("cod-recon POST lỗi:", e);
        return NextResponse.json({ error: "Không đọc được file sao kê" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const id = req.nextUrl.searchParams.get("statement") || "";
    if (!id) return NextResponse.json({ error: "Thiếu mã bản sao kê" }, { status: 400 });
    const after = await updateStore(STORE, emptyStore(), (cur) => ({
        statements: cur.statements.filter((s) => s.id !== id),
    }));
    return NextResponse.json({ ok: true, remaining: after.statements.length });
}
