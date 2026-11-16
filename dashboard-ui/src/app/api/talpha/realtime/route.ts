import { NextResponse } from "next/server";
import { DEFAULT_POS_TZ, addDaysStr } from "./_lib/time";
import { buildRealtimeReport } from "./_lib/build-report";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Meta live + POS (kho số cho ngày cũ, API trực tiếp cho hôm qua/hôm nay) → số Ads Command Center.
// Phần dựng nằm ở _lib/: build-report.ts (ghép đơn↔quảng cáo, lọc nước theo team),
// meta-ads.ts, pos-orders.ts, campaign-keys.ts, config.ts, time.ts.

// ═══ MAIN: Map ads ↔ orders by ad_id ═══
export async function GET(request: Request) {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    // S1 — order↔ad matching pool: include PAUSED/all-status ads by default so an
    // order from an ad that was turned off (but still spent in the range) matches.
    // Meta `insights` only returns ads that actually spent in [from,to], so dropping
    // the active filter widens the match pool WITHOUT inflating period spend. Pass
    // ?active_only=true to restrict to active campaigns again.
    const activeOnly = searchParams.get('active_only') === 'true'; // default: false (match all spending ads)
    // The from/to labels are interpreted per-account: Meta returns each account's
    // insights in its own timezone, and POS orders are bucketed to match (below).
    const vnToday = new Date().toLocaleDateString('sv-SE', { timeZone: DEFAULT_POS_TZ });
    const fromDate = searchParams.get('from_date') || vnToday;
    const toDate = searchParams.get('to_date') || vnToday;
    // POS fetch window: pad ±1 UTC day so no order is dropped before per-account-tz
    // bucketing (account offsets span -7…+9h, all < 24h).
    const todayUtc = new Date().toISOString().slice(0, 10);
    const fetchFrom = addDaysStr(fromDate, -1);
    const fetchTo = addDaysStr(toDate, 1);

    try {
        return NextResponse.json(await buildRealtimeReport(request, {
            startTime, activeOnly, fromDate, toDate, todayUtc, fetchFrom, fetchTo,
        }));
    } catch (error: any) {
        console.error("Realtime API error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
