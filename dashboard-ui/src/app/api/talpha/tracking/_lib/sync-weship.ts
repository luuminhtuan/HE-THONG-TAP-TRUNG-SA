import { NextResponse } from "next/server";
import { buildAlerts, countByStatus, type TrackMarket } from "@/lib/talpha/tracking";
import { syncWeshipMarket } from "@/lib/talpha/tracking-market";
import { loadShipments } from "./load-shipments";

/**
 * UAE: tra lại mọi mã AWB chưa kết thúc trên trang WeShip. Không khoá, không quota — chạy
 * bao nhiêu lần cũng được (nút "Tra WeShip", việc nền 06:00 và 21:30 cùng gọi route này).
 */
export async function syncWeship(mk: TrackMarket, from: string, to: string) {
    try {
        const ls = await syncWeshipMarket(mk);
        if (!ls.ok) return NextResponse.json({ error: `Tra WeShip thất bại: ${ls.error || "không rõ"}` }, { status: 502 });
        const { shipments } = await loadShipments(mk, from, to);
        return NextResponse.json({
            ok: true, provider: "weship", registered: 0,
            targets: ls.targets, checked: ls.checked, status_changed: ls.changed,
            not_found: ls.not_found, failed: ls.failed, error_note: ls.error ?? null,
            alerts: buildAlerts(shipments, new Date(), { staleDays: mk.stale_days }),
            counts: countByStatus(shipments),
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("tracking POST (WeShip) lỗi:", e);
        return NextResponse.json({ error: `Tra WeShip thất bại: ${msg}` }, { status: 500 });
    }
}
