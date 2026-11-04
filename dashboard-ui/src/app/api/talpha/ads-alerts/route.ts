import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Marketer từ tên campaign — RULE CHUNG (config/talpha_rules.json qua rules.ts).
// Trả tên hiển thị ("Lộc", "Chu Thuý"…) như trước; "" nếu không gán được.
import { scanCampaignMarketer, DISPLAY } from "@/lib/talpha/rules";
function marketerOf(name: string): string {
    const key = scanCampaignMarketer(name);
    return key ? DISPLAY[key] || key : "";
}

// Dữ liệu để bot bắn cảnh báo ads. "Hôm nay" = ngày mới nhất có trong bảng (né lệch tz).
// Trả: tổng spend hôm nay vs TB 7 ngày trước; campaign đốt tiền mà 0 tin nhắn (loại test).
export async function GET() {
    try {
        const [meta] = await query(`SELECT MAX(date) AS d FROM fb_ads_data`);
        const day = meta?.d;
        if (!day) return NextResponse.json({ error: "fb_ads_data rỗng" }, { status: 500 });

        const totRows = await query(`
                WITH daily AS (
                    SELECT date AS d, SUM(spend) s
                    FROM fb_ads_data
                    WHERE date BETWEEN @day::date - 7 AND @day::date
                    GROUP BY 1
                )
                SELECT
                    (SELECT s FROM daily WHERE d = @day::date) AS today,
                    (SELECT AVG(s) FROM daily WHERE d < @day::date) AS avg7d`, { day });
        const totalSpend = Number(totRows?.[0]?.today || 0);
        const avg7d = Number(totRows?.[0]?.avg7d || 0);

        // Campaign đốt tiền không ra tin nhắn (loại camp test), spend ≥ 100k để lọc nhiễu.
        // HAVING của Postgres không gọi được tên cột đặt ở SELECT → viết lại biểu thức.
        const waste = await query(`
                SELECT campaign_name, ANY_VALUE(account_name) account_name,
                       ROUND(SUM(spend)) spend,
                       SUM(messaging_conversations_started) msgs,
                       SUM(purchases) purchases
                FROM fb_ads_data
                WHERE date = @day::date
                  AND LOWER(campaign_name) !~ 'test'
                GROUP BY 1
                HAVING ROUND(SUM(spend)) >= 100000 AND SUM(messaging_conversations_started) = 0
                ORDER BY 3 DESC
                LIMIT 20`, { day });

        const wasteful = (waste as any[]).map(r => ({
            campaign: r.campaign_name,
            account: r.account_name,
            marketer: marketerOf(r.campaign_name),
            spend: Number(r.spend || 0),
            msgs: Number(r.msgs || 0),
            purchases: Number(r.purchases || 0),
        }));

        return NextResponse.json({
            day,
            totalSpend,
            avg7d: Math.round(avg7d),
            spikeRatio: avg7d > 0 ? Math.round((totalSpend / avg7d) * 100) / 100 : null,
            wasteful,
            fetchedAt: new Date().toISOString(),
        });
    } catch (e: any) {
        console.error("ads-alerts error:", e?.message || e);
        return NextResponse.json({ error: e?.message || "lỗi ads-alerts" }, { status: 500 });
    }
}
