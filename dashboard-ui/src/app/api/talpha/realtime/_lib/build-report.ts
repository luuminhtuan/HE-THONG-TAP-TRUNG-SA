import { getCredential } from "@/lib/talpha/credentials";
import { reportingAdAccounts } from "@/lib/talpha/ad-accounts";
import { normPosMarketer, campaignMarket, MESS_PANCAKE, MARKETS_PUBLIC } from "@/lib/talpha/rules";
import { loadShops } from "@/lib/talpha/pos-images";
import { pancakeMessByCampaign } from "@/lib/talpha/pancake-api";
import { splitMessByCampaign } from "@/lib/talpha/pancake";
import { getAccess } from "@/lib/talpha/access";
import { canMarket, seesAllMarkets } from "@/lib/talpha/access-rules";
import { loadConfig } from "./config";
import { parseCampaign, fallbackKey } from "./campaign-keys";
import { DEFAULT_POS_TZ, dateInTz } from "./time";
import { fetchMetaAds, fetchAccountTimezones } from "./meta-ads";
import { fetchPOSHybrid } from "./pos-orders";

/** Khoảng ngày + cờ lọc route đã đọc từ request (xem route.ts). */
export type RealtimeParams = {
    startTime: number;
    activeOnly: boolean;
    fromDate: string;
    toDate: string;
    todayUtc: string;
    fetchFrom: string;
    fetchTo: string;
};

// ═══ MAIN: Map ads ↔ orders by ad_id ═══
// `request` chỉ dùng để hỏi quyền người xem (getAccess) — lọc nước TRƯỚC khi ghép đơn↔quảng cáo.
export async function buildRealtimeReport(request: Request, params: RealtimeParams) {
    const { startTime, activeOnly, fromDate, toDate, todayUtc, fetchFrom, fetchTo } = params;
    const cfg = loadConfig();
    // TKQC: danh bạ tự động (lib/talpha/ad-accounts.ts, 04/11/2026) — TK thuộc loại vào báo cáo mà token còn
    // thấy, tên lấy từ Meta. Trước đó đọc talpha.yaml (ad_account_ids + ad_account_names gõ tay).
    // Nhiều token Meta: mỗi TK gọi bằng token đã đọc được nó (ad_accounts.token_env_var), thiếu thì token chính.
    const adAccounts = await reportingAdAccounts();
    const accountIds = adAccounts.map((t) => `act_${t.id}`);
    const accountNames: Record<string, string> = Object.fromEntries(adAccounts.map((t) => [`act_${t.id}`, t.name || `act_${t.id}`]));
    const tokenVarByAccount = Object.fromEntries(adAccounts.map((t) => [`act_${t.id}`, t.token_env_var]));
    const tokenFor = (accId: string) => (tokenVarByAccount[accId] && getCredential(tokenVarByAccount[accId]!)) || cfg.meta_ads.access_token;
    // Shop POS từ talpha_rules.json → markets (cùng nguồn với Kho, 04/11/2026), bỏ nước đã tắt:
    // không gọi POS sống. Đơn cũ của nó vẫn có ở phần đọc kho số (không lọc shop).
    const shops = loadShops();

    // A3-P2: gom cảnh báo cap phân trang (Meta 10 trang, POS 200 trang) trả về client
    const warnings: string[] = [];

    // Fetch in parallel (account timezones resolve alongside the main fetches)
    const [adsAll, ordersAll, accountTz] = await Promise.all([
        fetchMetaAds(tokenFor, accountIds, accountNames, activeOnly, fromDate, toDate, warnings),
        fetchPOSHybrid(shops, fetchFrom, fetchTo, todayUtc, warnings),
        fetchAccountTimezones(tokenFor, accountIds),
    ]);

    // Phân quyền theo team (05/10/2026): người xem một phần nước chỉ giữ quảng cáo của
    // campaign mang nước team mình ở tên (campaignMarket — cùng luật Sheet tách chi tiêu)
    // và đơn của shop nước đó. Lọc TRƯỚC khi ghép đơn↔quảng cáo để mọi tổng, ROAS, đơn
    // chưa map phía dưới tự là số của team. Bot (chìa nội bộ) xem hết như cũ.
    const viewer = await getAccess(request);
    const restricted = !viewer || !seesAllMarkets(viewer);
    const canSee = (m: string | null | undefined) => !!viewer && !!m && canMarket(viewer, m);
    const ads = restricted ? adsAll.filter((ad) => canSee(campaignMarket(ad.campaign_name).market)) : adsAll;
    const orders = restricted ? ordersAll.filter((o: any) => canSee(o.shop_name)) : ordersAll;

    // Build ad_id → ad index map for O(1) lookup
    const adIdMap = new Map<string, number>();
    ads.forEach((ad, idx) => {
        if (ad.ad_id) adIdMap.set(ad.ad_id, idx);
    });

    // Map orders to ads. An order counts toward [fromDate, toDate] only if its
    // day — computed in the matched ad account's timezone (so POS day = Meta day)
    // — falls in range. Unmatched orders use the POS-native VN day.
    const matchedOrders: any[] = [];        // khớp ad_id (gán vào ad cụ thể)
    const pendingOrders: any[] = [];        // trong cửa sổ ngày VN nhưng chưa khớp ad_id → thử fallback
    const unmatchedOrders: any[] = [];      // vẫn không nối được sau fallback
    // GTC thật (giao thành công) — gom song song với doanh thu 100%
    let unmatchedDeliveredVnd = 0;
    let deliveredOrderCount = 0;
    let fallbackMatchedCount = 0;
    let fallbackAmbiguousCount = 0; // đơn trùng ≥2 campaign — cố ý KHÔNG nối

    for (const order of orders) {
        if (order.ad_id && adIdMap.has(order.ad_id)) {
            const adIdx = adIdMap.get(order.ad_id)!;
            const tz = accountTz[ads[adIdx].account_id] || DEFAULT_POS_TZ;
            const bizDate = dateInTz(order.inserted_at, tz);
            if (bizDate < fromDate || bizDate > toDate) continue; // outside this account's day window
            ads[adIdx].orders += 1;
            ads[adIdx].revenue_vnd += order.total_price_vnd;
            if (order.delivered) { ads[adIdx].revenue_delivered_vnd += order.total_price_vnd; deliveredOrderCount += 1; }
            ads[adIdx].order_details.push({
                id: order.id,
                shop: order.shop_name,
                price_vnd: order.total_price_vnd,
                customer: order.customer_name,
            });
            matchedOrders.push(order);
        } else {
            const bizDate = dateInTz(order.inserted_at, DEFAULT_POS_TZ);
            if (bizDate < fromDate || bizDate > toDate) continue; // outside VN day window
            pendingOrders.push(order); // để lại cho bước fallback (marketer+market+page_id)
        }
    }

    // Group ads by campaign for summary
    const campaignMap = new Map<string, any>();
    for (const ad of ads) {
        const key = `${ad.account_id}__${ad.campaign_id}`;
        const existing = campaignMap.get(key);
        if (existing) {
            existing.spend_vnd += ad.spend_vnd;
            existing.impressions += ad.impressions;
            existing.link_clicks += ad.link_clicks;
            existing.messages += ad.messages;
            existing.purchases += ad.purchases;
            existing.orders += ad.orders;
            existing.revenue_vnd += ad.revenue_vnd;
            existing.revenue_delivered_vnd += ad.revenue_delivered_vnd;
            existing.ads.push(ad);
        } else {
            campaignMap.set(key, {
                account_id: ad.account_id,
                account_name: ad.account_name,
                campaign_id: ad.campaign_id,
                campaign_name: ad.campaign_name,
                spend_vnd: ad.spend_vnd,
                impressions: ad.impressions,
                link_clicks: ad.link_clicks,
                cpm_vnd: ad.cpm_vnd,
                ctr: ad.ctr,
                messages: ad.messages,
                purchases: ad.purchases,
                orders: ad.orders,
                revenue_vnd: ad.revenue_vnd,
                revenue_delivered_vnd: ad.revenue_delivered_vnd,
                roas: 0,
                ads: [ad],
            });
        }
    }

    // ─── Fallback: nối pendingOrders vào campaign theo marketer+market+page_id ───
    // (rule map của báo cáo Sheet). Gán ở cấp CAMPAIGN (không phải ad cụ thể) để
    // không phá attribution ad_id. NGUYÊN TẮC: chỉ nối khi khoá trỏ về ĐÚNG 1
    // campaign — KHÔNG đoán. Trùng ≥2 campaign / không khớp → để "chưa map" và ghi
    // lý do rõ ràng, không điền bậy vào campaign khác.
    const campByKey = new Map<string, any>();
    const ambiguousKeys = new Set<string>();
    for (const c of campaignMap.values()) {
        const { mkt, nv: marketerKey, pageId } = parseCampaign(c.campaign_name);
        const k = fallbackKey(marketerKey, mkt, pageId);
        if (!k) continue;
        if (campByKey.has(k)) ambiguousKeys.add(k); // đã có campaign khác cùng khoá → nhập nhằng
        else campByKey.set(k, c);
    }
    for (const order of pendingOrders) {
        const marketerKey = normPosMarketer(order.marketer);
        const k = fallbackKey(marketerKey, order.shop_name, order.page_id);
        const camp = (k && !ambiguousKeys.has(k)) ? campByKey.get(k) : null;
        if (camp) {
            camp.orders += 1;
            camp.revenue_vnd += order.total_price_vnd;
            if (order.delivered) { camp.revenue_delivered_vnd += order.total_price_vnd; deliveredOrderCount += 1; }
            fallbackMatchedCount += 1;
        } else {
            // Không nối chắc chắn → báo cáo là "chưa map" kèm lý do (không đoán)
            let reason: string;
            if (k && ambiguousKeys.has(k)) { reason = 'trung_nhieu_campaign'; fallbackAmbiguousCount += 1; }
            else if (!marketerKey) reason = 'marketer_ngoai_team';
            else if (!order.page_id) reason = 'thieu_page_id';
            else if (!order.shop_name || order.shop_name === 'Unknown') reason = 'thieu_thi_truong';
            else reason = 'khong_co_campaign_khop';
            order.unmatch_reason = reason;
            if (order.delivered) { unmatchedDeliveredVnd += order.total_price_vnd; deliveredOrderCount += 1; }
            unmatchedOrders.push(order);
        }
    }

    // ─── Nước Meta KHÔNG báo tin nhắn (Nhật — luật bảo vệ thông tin liên lạc, 09/10/2026) ───
    // Meta trả 0 mess cho camp Nhật → thay bằng hội thoại mới trên Pancake của page ghi trong tên
    // camp, chia cho các camp cùng page theo click Messenger (cùng luật tin mỗi giờ của bot), rồi
    // chia tiếp xuống từng ad cùng luật. Pancake hỏng thì giữ số Meta và nói ra trong warnings.
    let messPancake: { nuoc: string[]; tong: number; ok: boolean } | null = null;
    const campPk = [...campaignMap.values()].filter((c) => MESS_PANCAKE.includes(campaignMarket(c.campaign_name).market || ""));
    if (campPk.length) {
        const marketNames = MESS_PANCAKE.map((k) => MARKETS_PUBLIC.markets.find((m) => m.key === k)?.display || k).join(", ");
        const pk = await pancakeMessByCampaign(campPk, fromDate, toDate, startTime + 40_000);
        messPancake = { nuoc: MESS_PANCAKE, tong: pk.tong, ok: pk.ok };
        if (!pk.ok) warnings.push(`Tin nhắn ${marketNames}: Pancake lỗi (${pk.loi}) — mess camp ${marketNames} đang là số Meta (Meta không báo, luôn 0).`);
        else {
            for (const c of campPk) {
                const n = pk.theoCamp.get(c) ?? 0;
                c.messages = n;
                c.mess_nguon = "pancake";
                const perAd = splitMessByCampaign(n, c.ads);
                c.ads.forEach((a: any, i: number) => { a.messages = perAd[i]; });
            }
            if (pk.thieu.length) warnings.push(`Tin nhắn ${marketNames}: đếm chưa hết ở ${pk.thieu.join(", ")} (khoảng ngày dài / hết giờ) — số mess đang THIẾU.`);
            if (pk.khong_thay.length) warnings.push(`Tin nhắn ${marketNames}: tài khoản Pancake không thấy page ${pk.khong_thay.join(", ")} (page đổi tên?) — camp của page đó 0 mess.`);
        }
    }

    // Calculate ROAS per campaign
    const campaigns = Array.from(campaignMap.values()).map(c => ({
        ...c,
        roas: c.spend_vnd > 0 ? Math.round((c.revenue_vnd / c.spend_vnd) * 100) / 100 : 0,
        cpm_vnd: c.impressions > 0 ? (c.spend_vnd / c.impressions) * 1000 : 0,
        ads_count: c.ads.length,
        ads: c.ads.map((a: any) => ({
            ad_id: a.ad_id,
            ad_name: a.ad_name,
            adset_name: a.adset_name,
            spend_vnd: a.spend_vnd,
            impressions: a.impressions,
            link_clicks: a.link_clicks,
            cpm_vnd: a.cpm_vnd,
            cpc_vnd: a.cpc_vnd,
            ctr: a.ctr,
            messages: a.messages,
            purchases: a.purchases,
            orders: a.orders,
            revenue_vnd: a.revenue_vnd,
            roas: a.spend_vnd > 0 ? Math.round((a.revenue_vnd / a.spend_vnd) * 100) / 100 : 0,
        })),
    })).sort((a, b) => b.spend_vnd - a.spend_vnd);

    // Summary totals
    const totalSpendVnd = campaigns.reduce((s, c) => s + c.spend_vnd, 0);
    const matchedRevenueVnd = campaigns.reduce((s, c) => s + c.revenue_vnd, 0);
    const matchedDeliveredVnd = campaigns.reduce((s, c) => s + (c.revenue_delivered_vnd || 0), 0);
    const matchedOrderCount = campaigns.reduce((s, c) => s + c.orders, 0);
    const totalMessages = campaigns.reduce((s, c) => s + c.messages, 0);
    const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);

    // Unmatched revenue by shop + thống kê LÝ DO chưa map (để báo cáo, không đoán)
    const unmatchedByShop: Record<string, { count: number; revenue_vnd: number }> = {};
    const unmatchedByReason: Record<string, { count: number; revenue_vnd: number }> = {};
    let unmatchedRevenueVnd = 0;
    for (const o of unmatchedOrders) {
        const shop = o.shop_name || 'Unknown';
        if (!unmatchedByShop[shop]) unmatchedByShop[shop] = { count: 0, revenue_vnd: 0 };
        unmatchedByShop[shop].count += 1;
        unmatchedByShop[shop].revenue_vnd += o.total_price_vnd;
        const reason = o.unmatch_reason || 'khong_ad_id';
        if (!unmatchedByReason[reason]) unmatchedByReason[reason] = { count: 0, revenue_vnd: 0 };
        unmatchedByReason[reason].count += 1;
        unmatchedByReason[reason].revenue_vnd += o.total_price_vnd;
        unmatchedRevenueVnd += o.total_price_vnd;
    }

    // Total revenue = matched + unmatched
    const totalRevenueVnd = matchedRevenueVnd + unmatchedRevenueVnd;
    // GTC thật (giao thành công) — rule của báo cáo Sheet, thay ước lượng 65% cứng.
    // Với view "hôm nay/gần đây" số này thường thấp vì đơn mới chưa giao xong.
    const deliveredRevenueVnd = matchedDeliveredVnd + unmatchedDeliveredVnd;
    const deliveredRoas = totalSpendVnd > 0 ? Math.round((deliveredRevenueVnd / totalSpendVnd) * 100) / 100 : 0;

    // Determine POS source label
    const hasDb = orders.some((o: any) => o.source === 'kho');
    const hasDirect = orders.some((o: any) => o.source === 'direct_api');
    const posSource = hasDb && hasDirect ? 'Kho+API' : hasDb ? 'Kho' : 'Direct API';

    return {
        source: `META:Direct|POS:${posSource}`,
        fetched_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        // Cảnh báo cap phân trang — rỗng khi dữ liệu lấy trọn
        warnings,
        // Danh sách 14 TKQC từ talpha.yaml — client dùng làm dropdown + tên hiển thị
        accounts: accountIds.map((id) => ({ id, name: accountNames[id] || id })),
        summary: {
            total_spend_vnd: totalSpendVnd,
            total_revenue_vnd: totalRevenueVnd,
            matched_revenue_vnd: matchedRevenueVnd,
            unmatched_revenue_vnd: unmatchedRevenueVnd,
            delivered_revenue_vnd: deliveredRevenueVnd, // GTC thật (status GIAO_THANH_CONG)
            delivered_orders: deliveredOrderCount,
            delivered_roas: deliveredRoas,
            total_orders: matchedOrderCount,
            total_messages: totalMessages,
            // Phần tin nhắn đếm ở Pancake (nước Meta không báo) — null khi không có camp nước đó.
            mess_pancake: messPancake,
            matched_orders: matchedOrders.length + fallbackMatchedCount,
            matched_via_adid: matchedOrders.length,
            matched_via_fallback: fallbackMatchedCount,
            unmatched_orders: unmatchedOrders.length,
            unmatched_ambiguous: fallbackAmbiguousCount, // trùng ≥2 campaign, cố ý không nối
            total_pos_orders: matchedOrders.length + fallbackMatchedCount + unmatchedOrders.length,
            total_meta_purchases: totalPurchases,
            blended_roas: totalSpendVnd > 0 ? Math.round((totalRevenueVnd / totalSpendVnd) * 100) / 100 : 0,
            accounts_fetched: accountIds.length,
            shops_fetched: shops.length,
        },
        campaigns,
        unmatched_orders: unmatchedOrders.slice(0, 50).map(o => ({
            id: String(o.id || ''), shop: String(o.shop_name || ''), price_vnd: o.total_price_vnd,
            ad_id: o.ad_id ? String(o.ad_id) : 'none', page_id: o.page_id ? String(o.page_id) : 'none',
            marketer: String(o.marketer || ''), reason: String(o.unmatch_reason || 'khong_ad_id'),
        })),
        unmatched_by_shop: unmatchedByShop,
        unmatched_by_reason: unmatchedByReason,
    };
}
