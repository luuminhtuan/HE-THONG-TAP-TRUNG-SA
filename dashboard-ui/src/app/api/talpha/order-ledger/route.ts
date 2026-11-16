import { NextRequest, NextResponse } from "next/server";
import { buildOrderLedger } from "./_lib/build-order-ledger";

export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════
// SỔ ĐƠN HÀNG — một dòng mỗi đơn, kèm đủ vòng đời của tiền.
//
// Ghép ba kho lại:
//   kho `tracking`         → đơn, khách, hàng, trạng thái giao (từ file đối tác)
//   kho `cod_statements`   → tiền 3PL đã trả + phí từng đơn + tỷ giá từng kỳ
//   config products        → giá vốn
//
// Chỉ ĐỌC. Mọi thay đổi dữ liệu đi qua route tracking/import và cod-recon.
//
// Phần dựng nằm ở _lib/: build-order-ledger.ts (ghép các khối), period-cash-flow.ts
// (luồng tiền một kỳ), periods.ts (từng kỳ sao kê, tỷ giá, đơn chưa về tiền),
// checks.ts (8 mục kiểm tra), tasks.ts (việc hôm nay), warnings.ts (cảnh báo),
// money-summary.ts (tiền về + tổng quan).
// ═══════════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
    const q = req.nextUrl.searchParams;
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") || "")
        ? (q.get("to") as string)
        : new Date().toISOString().slice(0, 10);

    try {
        return NextResponse.json(await buildOrderLedger(asOf, q.get("from")));
    } catch (e) {
        console.error("order-ledger GET lỗi:", e);
        return NextResponse.json({ error: "Không dựng được sổ đơn hàng" }, { status: 500 });
    }
}
