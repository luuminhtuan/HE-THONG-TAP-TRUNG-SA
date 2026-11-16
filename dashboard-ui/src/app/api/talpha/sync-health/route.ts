import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { parseFetchErrors } from "@/lib/talpha/refresh-status";
import { RULES, SHOP2MKT, ACTIVE_MARKETS, campaignMarket } from "@/lib/talpha/rules";
import { findStalledShops } from "@/lib/talpha/stalled-shops";

export const dynamic = "force-dynamic";

// Ngưỡng cảnh báo hệ thống — config/talpha_rules.json → thresholds (12/11/2026).
const THRESHOLDS = (RULES as unknown as { thresholds?: Record<string, unknown> }).thresholds || {};
const threshold = (k: string, fallback: number) => (Number(THRESHOLDS[k]) > 0 ? Number(THRESHOLDS[k]) : fallback);

// B5 — trạng thái theo TỪNG TKQC/shop của vòng chạy mới nhất. Bảng do
// ops/talpha_reports/report_account_health.py ghi. Chỉ trả về mục CÓ VẤN ĐỀ
// ("empty" = mất sạch dòng, "drop" = tụt bất thường) — "stale" là mục thật sự
// không phát sinh (camp tạm dừng), KHÔNG phải lỗi sync nên không đưa vào cảnh báo.
async function accountHealth() {
    try {
        // NULLS LAST: Postgres xếp NULL lên ĐẦU khi DESC (BigQuery xếp cuối) — giữ thứ tự cũ.
        const rows = await query(`
                SELECT run_ts, kind, entity_name, rows_total, prev_rows_total, status,
                       trunc(EXTRACT(EPOCH FROM (now() - run_ts)) / 60)::bigint AS age_min
                FROM sync_health_accounts
                WHERE run_ts = (SELECT MAX(run_ts) FROM sync_health_accounts)
                ORDER BY rows_total DESC NULLS LAST`);
        if (!rows?.length) return null;
        const bad = rows.filter((r: any) => r.status === "empty" || r.status === "drop");
        const age = rows[0].age_min == null ? NaN : Number(rows[0].age_min);
        return {
            run_ts: rows[0].run_ts,
            // Tuổi lượt soát gần nhất. Bộ soát hỏng thì bảng đứng ở lượt cuối và route cứ trả
            // "0 mục lỗi" mãi — 30/09→12/11/2026 hỏng 6 tuần không ai biết. Bot kêu khi quá ngưỡng.
            age_minutes: Number.isFinite(age) ? age : null,
            checked: rows.length,
            failing: bad.map((r: any) => ({
                kind: r.kind,
                name: r.entity_name,
                rows: Number(r.rows_total),
                prev_rows: r.prev_rows_total == null ? null : Number(r.prev_rows_total),
                status: r.status,
            })),
        };
    } catch {
        // Chưa có bảng (chưa vòng nào ghi) → coi như chưa bật, KHÔNG làm hỏng route gốc.
        return null;
    }
}

// Shop đứng im: ads của nước còn tiêu mà shop POS nước đó không có đơn mới nhiều ngày — xem
// lib/talpha/stalled-shops.ts. Hỏng thì trả [] (cảnh báo phụ, không được làm hỏng route gốc).
async function stalledShops() {
    const days = threshold("stalled_shop_days", 3);
    try {
        // inserted_at là chuỗi ISO giờ UTC của POS — 10 ký tự đầu là ngày (lệch tối đa 7 giờ, đủ cho ngưỡng tính bằng ngày).
        const [orders, ads] = await Promise.all([
            query<{ shop_label: string; last_order_date: string | null }>(`
                SELECT shop_label, MAX(SUBSTR(inserted_at, 1, 10)) AS last_order_date
                FROM sale_order GROUP BY 1`),
            query<{ campaign_name: string; spend: number }>(`
                SELECT campaign_name, SUM(spend) AS spend
                FROM fb_ads_data
                WHERE date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - @days::int
                  AND date < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                GROUP BY 1`, { days }),
        ]);
        const shopOfMarket = Object.fromEntries(Object.entries(SHOP2MKT).map(([shop, mkt]) => [mkt, shop]));
        const adsByShop: Record<string, number> = {};
        for (const r of ads) {
            const shop = shopOfMarket[campaignMarket(r.campaign_name).market || ""];
            if (shop) adsByShop[shop] = (adsByShop[shop] || 0) + Number(r.spend || 0);
        }
        const lastOrderDate = Object.fromEntries(orders.map((r) => [r.shop_label, r.last_order_date]));
        const shops = Object.entries(SHOP2MKT).filter(([shop, mkt]) => shop && ACTIVE_MARKETS.has(mkt)).map(([shop]) => shop);
        const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
        return findStalledShops(shops, lastOrderDate, adsByShop, today, { days, minAds: threshold("stalled_shop_min_ads_vnd", 500000) });
    } catch {
        return [];
    }
}

// Tên TKQC / shop đọc lỗi trong vòng chạy: parseFetchErrors (lib/talpha/refresh-status.ts — dùng chung với
// đèn trạng thái cập nhật trên dashboard).

// Trạng thái chuỗi sync Sheet (Mac, launchd mỗi giờ). Bot WhatsApp poll route này
// để cảnh báo khi sync FAIL hoặc IM LẶNG quá lâu (chống sự cố "chết câm" 22-29/6).
export async function GET() {
    try {
        const [accounts, stalled_shops] = await Promise.all([accountHealth(), stalledShops()]);
        // age_min = số PHÚT TRÒN đã qua (cắt phần lẻ, như TIMESTAMP_DIFF … MINUTE bản cũ).
        const rows = await query(`
                SELECT ts, host, ok, sync_rc, format_rc, detail,
                       trunc(EXTRACT(EPOCH FROM (now() - ts)) / 60)::bigint AS age_min
                FROM sync_health
                ORDER BY ts DESC LIMIT 200`);
        if (!rows?.length) return NextResponse.json({ status: "no-data", accounts });
        const last = rows[0];
        // LIMIT 200 (≈8 ngày chạy mỗi giờ), KHÔNG phải 5: route chỉ dùng dòng mới nhất và
        // dòng OK gần nhất, nhưng với 5 dòng thì sau 5 vòng hỏng liên tiếp lastOk thành
        // undefined → last_ok_age_minutes = null → bot Zalo coi như "không biết tuổi số"
        // và BỎ LUÔN dòng cảnh báo "SỐ CHƯA ĐỦ", đúng lúc số sai nhất. Dính thật 22/09/2026:
        // 3 TKQC mất quyền ads_read từ đêm → mỗi vòng SKIP format_all, Sheet đứng 13 giờ.
        const lastOk = rows.find((r: any) => r.ok);
        // 23/09/2026: TKQC mất quyền ads_read vẫn còn dòng cũ nên accountHealth() báo "ok" —
        // lấy tên thẳng từ log vòng chạy rồi gộp vào danh sách lỗi để bot báo đích danh.
        const fetch_errors = parseFetchErrors(last.detail);
        const fetchErrors = [
            ...fetch_errors.tkqc.map((name) => ({
                kind: "ads", name, rows: null, prev_rows: null,
                status: fetch_errors.mat_quyen.includes(name) ? "mat_quyen" : "khong_doc_duoc",
            })),
            ...fetch_errors.shops.map((name) => ({ kind: "orders", name, rows: null, prev_rows: null, status: "khong_doc_duoc" })),
        ];
        const accountsOut = accounts || fetchErrors.length
            ? { ...(accounts || { run_ts: null, checked: 0 }), failing: [...fetchErrors, ...(accounts?.failing || [])] }
            : null;
        return NextResponse.json({
            status: last.ok ? "ok" : "fail",
            accounts: accountsOut,
            fetch_errors,
            stalled_shops,
            health_check_stale_minutes: threshold("health_check_stale_minutes", 180),
            last_run_ts: last.ts,
            age_minutes: Number(last.age_min),
            last_ok_age_minutes: lastOk ? Number(lastOk.age_min) : null,
            sync_rc: last.sync_rc, format_rc: last.format_rc,
            detail: last.detail,
        });
    } catch (e: any) {
        // bảng chưa tồn tại (chưa có run nào ghi) → coi như no-data, không phải lỗi
        if (e?.code === "42P01") return NextResponse.json({ status: "no-data" });
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
