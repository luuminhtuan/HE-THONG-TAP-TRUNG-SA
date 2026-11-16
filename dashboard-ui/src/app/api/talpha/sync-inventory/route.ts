import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { buildInventoryPayload } from "@/lib/talpha/inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Build payload tồn kho (POS Poscake, cùng nguồn với /api/talpha/inventory) → ghi 1
// snapshot vào kho số (bảng inventory_snapshot). Snapshot này LÀ đường dự phòng của tab
// Kho khi POS chết, nên phải chạy đều: launchd com.talpha.snapshot-inventory mỗi 15'
// gọi qua ops/talpha_reports/snapshot_cron.sh (C2).
// Bảo vệ nhẹ: nếu set TALPHA_SYNC_TOKEN thì phải khớp header x-talpha-token
// (ưu tiên) hoặc ?token= (giữ tương thích bản cũ — URL lộ trong log/ps, đừng dùng nữa).
async function handler(req: Request) {
    const token = process.env.TALPHA_SYNC_TOKEN;
    if (token) {
        const got = req.headers.get("x-talpha-token") || new URL(req.url).searchParams.get("token");
        if (got !== token) {
            return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
    }

    const start = Date.now();
    try {
        const payload = await buildInventoryPayload();

        // Thêm 1 dòng vào inventory_snapshot.
        // source = nguồn THẬT của payload, không phải nhãn cố định. buildInventoryPayload()
        // throw khi POS không trả dữ liệu (không có đường rơi về Sheet), nên mọi dòng ghi
        // được ở đây đều là POS Poscake live. Nhãn "gsheet" là di sản thời còn đọc Google
        // Sheet thủ công — để nguyên thì bảng tự mô tả sai, mà inventory_snapshot lại nằm
        // trong danh sách bảng thô cho CEO-ask (ceo-ask-prompt.ts) → LLM đọc nhầm xuất xứ.
        // Payload là JSON tồn kho đầy đủ, ghi đều theo lịch → phải có hạn xoá, nếu không bảng phình
        // vô hạn. Giữ 60 ngày (bản BigQuery dùng hạn xoá phân vùng 60 ngày): dọn dòng quá hạn
        // trong CÙNG transaction — ghi lỗi thì không xoá gì.
        await withTransaction(async (q) => {
            await q(
                `INSERT INTO inventory_snapshot (snapshot_time, source, payload)
                 VALUES (now(), 'pos-poscake', @payload)`,
                { payload: JSON.stringify(payload) },
            );
            await q(`DELETE FROM inventory_snapshot WHERE snapshot_time < now() - interval '60 days'`);
        });

        return NextResponse.json({
            ok: true,
            table: "inventory_snapshot",
            skus: payload.skuMatrix.length,
            markets: payload.marketOverview.length,
            transfers: payload.transfers.length,
            restocks: payload.restocks.length,
            duration_ms: Date.now() - start,
        });
    } catch (e: any) {
        console.error("sync-inventory error:", e);
        return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
    }
}

export const GET = handler;
export const POST = handler;
