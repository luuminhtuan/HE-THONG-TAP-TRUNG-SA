// GET /api/talpha/pancake-messages?market=JP&date=YYYY-MM-DD[&trang=Tên page 1|Tên page 2]
//
// Số của MỘT nước một ngày theo PAGE — cho nước mà Meta không báo số tin nhắn (Nhật, Sỹ Anh yêu
// cầu 09/10/2026: tin Zalo mỗi giờ có mess, giá mess, đơn, doanh số). Bot Zalo ghép thêm tiền
// ads từng camp (Meta trực tiếp, /api/talpha/realtime) bằng tên page trong tên camp.
//
//   • tin nhắn / bình luận mới / có SĐT — Pancake (lib/talpha/pancake.ts), token tài khoản ở
//     TALPHA_PANCAKE_API_TOKEN;
//   • page của nước = page có tên nằm trong tên camp của nước đó tháng này (fb_ads_data), cộng
//     page tên có mã nước (… JP), cộng ?trang= bot gửi (camp tạo hôm nay chưa kịp sync);
//   • chủ page = marketer của camp gần nhất chạy page đó;
//   • đơn / doanh số theo page — bảng sale_order, CÙNG luật Sheet (bỏ HUY, DON_THO, đơn trống),
//     tiền quy bằng posMoneyDivisor + tỷ giá của nước.
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { MARKETS_PUBLIC, EXCHANGE_RATES, posMoneyDivisor, campaignMarket, DISPLAY, normCampMarketer, CAMP_MARKETS } from "@/lib/talpha/rules";
import { normalizePageName, pageOfCampaign, countForDay, isMarketPage } from "@/lib/talpha/pancake";
import { listPages, conversationsSince, sleep, GIAN_MS, tokenPancake } from "@/lib/talpha/pancake-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

type Result = Record<string, unknown>;
const CACHE = new Map<string, { at: number; kq: Result }>();

export async function GET(req: NextRequest) {
    const sp = req.nextUrl.searchParams;
    const code = String(sp.get("market") || "").toUpperCase();
    const market = MARKETS_PUBLIC.markets.find((m) => m.code === code);
    if (!market) return NextResponse.json({ error: `market lạ: ${code || "(trống)"}` }, { status: 400 });
    const date = sp.get("date") || todayVN();
    if (!DATE_RE.test(date)) return NextResponse.json({ error: "date phải dạng YYYY-MM-DD" }, { status: 400 });
    const extraPages = String(sp.get("trang") || "").split("|").map((x) => x.trim()).filter(Boolean);

    // Bot gửi mỗi giờ + bản tin thường cùng giờ: giữ 3 phút để hai lượt không gọi Pancake hai lần.
    const cacheKey = `${code}|${date}|${extraPages.map(normalizePageName).sort().join("|")}`;
    const hit = CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at < 180_000) return NextResponse.json(hit.kq);

    const errors: string[] = [];
    const month = date.slice(0, 7);

    // ── Camp của nước này trong tháng → page (tên) → chủ page + camp ──
    const pageOwners = new Map<string, { ten: string; nv: string | null; camps: Set<string>; ngayCuoi: string }>();
    const recordCamp = (cn: string, d: string) => {
        const t = pageOfCampaign(cn);
        if (!t) return;
        const k = normalizePageName(t);
        const p = cn.split("/").map((x) => x.trim());
        const mi = p.findIndex((s) => s.toUpperCase() in CAMP_MARKETS);
        const key = mi >= 0 && mi + 1 < p.length ? normCampMarketer(p[mi + 1]) : null;
        const existing = pageOwners.get(k);
        if (!existing) pageOwners.set(k, { ten: t, nv: key ? DISPLAY[key] || key : null, camps: new Set([cn]), ngayCuoi: d });
        else {
            existing.camps.add(cn);
            if (d >= existing.ngayCuoi && key) { existing.nv = DISPLAY[key] || key; existing.ngayCuoi = d; }
        }
    };
    try {
        const rows = await query(
            `SELECT campaign_name, to_char(MAX(date), 'YYYY-MM-DD') AS d FROM fb_ads_data
             WHERE date >= @dau::date AND date <= @ngay::date GROUP BY 1`,
            { dau: `${month}-01`, ngay: date },
        );
        for (const r of rows as { campaign_name: string; d: string }[]) {
            if (campaignMarket(r.campaign_name).market === market.key) recordCamp(r.campaign_name, r.d);
        }
    } catch (e: any) { errors.push(`đọc camp tháng ${month} lỗi: ${e?.message || e}`); }
    for (const t of extraPages) if (!pageOwners.has(normalizePageName(t))) pageOwners.set(normalizePageName(t), { ten: t, nv: null, camps: new Set(), ngayCuoi: "" });

    // ── Pancake: tin nhắn mới theo page ──
    const { tok, het_han: expired, loi: tokenError } = tokenPancake();
    const pancake = { ok: false, het_han: expired, loi: tokenError };
    const pages: Result[] = [];
    if (!tokenError) {
        try {
            const allPages = await listPages(tok);
            // Khớp theo tên camp là chính; luật đuôi tên CHỈ nhận đúng mã nước (… JP) — "Prime Leather
            // Japan", "GoutEase … Spray Japan" là page SẢN PHẨM bán ở Đài, đuôi "Japan" là tên hàng.
            const marketPages = allPages.filter((p) => pageOwners.has(normalizePageName(p.name)) || isMarketPage(p.name, [market.code]));
            for (const p of marketPages) {
                const owner = pageOwners.get(normalizePageName(p.name));
                try {
                    const counts = countForDay((await conversationsSince(tok, p.id, date)).hts, date);
                    pages.push({ page_id: p.id, name: p.name, nv: owner?.nv || null, camps: owner ? [...owner.camps] : [], ...counts });
                } catch (e: any) {
                    // Page chưa chạy camp nào mà Pancake báo lỗi (chưa có gói cước…) thì bỏ, khỏi làm rối tin.
                    if (owner) pages.push({ page_id: p.id, name: p.name, nv: owner.nv || null, camps: [...owner.camps], loi: String(e?.message || e) });
                }
                await sleep(GIAN_MS);
            }
            // Page có camp mà tài khoản Pancake không thấy — nói ra, đừng lặng lẽ thành 0 mess.
            const seenPages = new Set(allPages.map((p) => normalizePageName(p.name)));
            // Chỉ báo khi camp CÓ TIÊU trong ngày: page đổi tên (10/10/2026 "Lucky Silver JP" thành
            // "Veloura Collection Gold") thì camp cũ đã tắt vẫn mang tên cũ — báo là nhiễu.
            for (const [k, v] of pageOwners) if (!seenPages.has(k) && v.ngayCuoi === date) pages.push({ page_id: null, name: v.ten, nv: v.nv, camps: [...v.camps], loi: "tài khoản Pancake không thấy page này (page đổi tên?)" });
            pancake.ok = true;
        } catch (e: any) { pancake.loi = String(e?.message || e); }
    }

    // ── Đơn + doanh số theo page (bảng đơn, cùng luật Sheet) ──
    const orders: Result[] = [];
    try {
        // total_quantity là chuỗi: không phải số thì coi như 0 (như SAFE_CAST cũ), đừng để ::float8 làm chết câu.
        const rows = await query(
            `SELECT COALESCE(page_name, '') AS page_name, page_id,
                    safe_json(marketer) ->> 'name' AS tag, COUNT(*) AS n, SUM(COALESCE(cod, 0)) AS cod
             FROM sale_order
             WHERE UPPER(shop_label) = @code
               AND ngay_theo_mui(inserted_at, 'Asia/Ho_Chi_Minh') = @ngay::date
               AND status_category NOT IN ('HUY', 'DON_THO')
               AND NOT (COALESCE(CASE WHEN total_quantity ~ '^[[:space:]]*[-+]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][-+]?[0-9]+)?[[:space:]]*$'
                                      THEN total_quantity::float8 END, 0) = 0
                        AND COALESCE(total_price, 0) = 0 AND COALESCE(cod, 0) = 0)
             GROUP BY 1, 2, 3`,
            { code, ngay: date },
        );
        const divisor = posMoneyDivisor(code), rate = EXCHANGE_RATES[market.key] || 0;
        for (const r of rows as { page_name: string; page_id: string | null; tag: string | null; n: number; cod: number }[]) {
            const local = Number(r.cod || 0) / divisor;
            orders.push({ page_name: r.page_name, page_id: r.page_id, tag: r.tag, don: Number(r.n), ds_local: Math.round(local), ds_vnd: Math.round(local * rate) });
        }
    } catch (e: any) { errors.push(`đọc đơn lỗi: ${e?.message || e}`); }

    const result: Result = {
        market: code, key: market.key, date: date, currency: market.currency, symbol: market.symbol, rate_vnd: market.rate_vnd,
        pancake, pages, don: orders, loi: errors, luc: new Date().toISOString(),
    };
    CACHE.set(cacheKey, { at: Date.now(), kq: result });
    return NextResponse.json(result);
}
